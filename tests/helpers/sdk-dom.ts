import { JSDOM } from 'jsdom'
import { initSelfHealing } from '@/sdk'
import { Transport } from '@/sdk/transport'
import { detectStruggles } from '@/lib/struggle/detect'
import type { ElementBaseline, DetectorContext } from '@/lib/struggle/detect'
import type { RuntimeEvent } from '@/lib/types/events'
import { vi } from 'vitest'

/**
 * Boot the REAL SDK against a live jsdom document, drive its real timers and
 * listeners, and capture the events it actually emits. No SDK scheduling or
 * detection logic is re-implemented here: the SDK decides when to emit, the
 * server detector decides what a detection is, and the test asserts on those.
 */

export interface SdkRun {
  events: RuntimeEvent[]
  /** The document the SDK is watching. */
  doc: Document
  win: Window & typeof globalThis
  stop: () => void
}

/**
 * A fresh DOM, installed with the WebCrypto global the SDK hashes element IDs
 * through (`window.crypto` on a real browser). jsdom omits `crypto.subtle`.
 */
export function installDom(html: string, url = 'http://localhost/checkout'): void {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url })
  const w = dom.window as unknown as Window & typeof globalThis
  if (!w.crypto?.subtle) {
    Object.defineProperty(w, 'crypto', {
      value: globalThis.crypto,
      writable: true,
      configurable: true,
    })
  }
  const define = (key: string, value: unknown) =>
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: false,
    })
  define('window', w)
  define('document', w.document)
  define('navigator', w.navigator)
  for (const key of [
    'location',
    'history',
    'sessionStorage',
    'localStorage',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLTextAreaElement',
    'HTMLSelectElement',
    'HTMLButtonElement',
    'HTMLFormElement',
    'Element',
    'Event',
    'CustomEvent',
    'MouseEvent',
    'KeyboardEvent',
    'EventTarget',
    'MutationObserver',
    'getComputedStyle',
  ]) {
    define(key, (w as unknown as Record<string, unknown>)[key])
  }
}

/**
 * Boot the SDK on a fresh, empty module graph (its `initialized` flag lives at
 * module scope, so one SDK per test file needs one isolated import).
 */
export async function bootSdk(html: string, now = 1_700_000_000_000): Promise<SdkRun> {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  installDom(html)

  // `initialized` is module scope in the SDK, so a second boot in the same
  // module graph would silently install no listeners at all and the test would
  // pass or fail on a missing SDK rather than on behaviour. Reset the graph.
  vi.resetModules()

  const events: RuntimeEvent[] = []
  const { initSelfHealing } = await import('@/sdk')
  const { EventBuffer } = await import('@/sdk/event-buffer')
  const { Transport } = await import('@/sdk/transport')
  const bufferPush = EventBuffer.prototype.push
  const pushSpy = vi
    .spyOn(EventBuffer.prototype, 'push')
    .mockImplementation(function (
      this: InstanceType<typeof EventBuffer>,
      event: RuntimeEvent,
    ) {
      events.push(event)
      return bufferPush.call(this, event)
    })

  // The SDK must never touch the network from a test.
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('{"interventions":[]}', { status: 200 }))
  const flushSpy = vi.spyOn(Transport.prototype, 'flush').mockResolvedValue({ sent: 0 })

  initSelfHealing({ orgId: 'org_test', endpoint: '/api/events', flushIntervalMs: 60_000 })

  // The document the SDK itself will listen on. `initSelfHealing` only touches
  // the DOM when one exists, and the SDK reads `document` at call time, so this
  // snapshot is the object events must be dispatched into. Returning it (rather
  // than re-reading `globalThis.document`, which a later `installDom` could
  // replace) keeps `run.doc` and the SDK's own view the same object - a
  // mismatch silently swallows synthetic input, which looked like an SDK bug.
  const sdkDoc = globalThis.document

  return {
    events,
    doc: sdkDoc,
    win: globalThis.window as unknown as Window & typeof globalThis,
    stop: () => {
      pushSpy.mockRestore()
      fetchSpy.mockRestore()
      flushSpy.mockRestore()
      vi.useRealTimers()
    },
  }
}

/**
 * Advance the SDK's virtual clock, letting its timers fire.
 *
 * `advanceTimersByTimeAsync` can deliver more than one 1s interval callback for
 * a single advance depending on how the fake clock drains, and the SDK's emit
 * path is promise-chained (element IDs hash through WebCrypto). Draining the
 * microtask queue after the advance makes one `tick(1000)` mean "the SDK has
 * settled its work for one more second", so callers can reason about a tick
 * count instead of about the scheduler's internal batching.
 */
export async function tick(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  // Let every queued microtask (emit chain, hashing) run to completion.
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

/**
 * A real mousemove through the SDK's own listener.
 *
 * The event is constructed from the TARGET's own document view, not from
 * `globalThis`, so a mousemove can never be built against one jsdom window and
 * dispatched into another. Doing that silently fails to reach the SDK's
 * document-level listener, which is what made a resumed-interaction test flake
 * on a loaded box: the interaction never registered and the quiet stretch
 * looked like it had never been interrupted.
 */
export function moveMouse(target?: Element | null): void {
  const el = target ?? globalThis.document.body
  const view = el.ownerDocument.defaultView ?? globalThis.window
  el.dispatchEvent(
    new view.MouseEvent('mousemove', { bubbles: true, cancelable: true }),
  )
}

/** A real click through the SDK's own listener (same view rule as moveMouse). */
export function click(el: Element): void {
  const view = el.ownerDocument.defaultView ?? globalThis.window
  el.dispatchEvent(new view.MouseEvent('click', { bubbles: true, cancelable: true }))
}

export function eventsOf(events: RuntimeEvent[], type: string): RuntimeEvent[] {
  return events.filter((e) => e.eventType === type)
}

export function dwellEvents(events: RuntimeEvent[]): RuntimeEvent[] {
  return eventsOf(events, 'DWELL')
}

/** Feed captured SDK events to the REAL server detector. */
export function detect(
  events: RuntimeEvent[],
  baselines?: Map<string, ElementBaseline>,
): ReturnType<typeof detectStruggles> {
  const ctx: DetectorContext = baselines ? { baselines } : {}
  return detectStruggles(events, ctx)
}
