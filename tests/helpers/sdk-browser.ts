/**
 * Real-browser harness for the SDK.
 *
 * The SDK is browser code: it listens on `document`, walks `history`, reads
 * `sessionStorage`, and only initialises when a `window` exists. None of that
 * can be faked with a mock object without testing the mock instead of the SDK.
 *
 * So this installs a `jsdom` window as the Node globals, then drives the real
 * `initSelfHealing` against it: the SDK decides which events to emit and when,
 * and the test asserts on what it actually captured. The trap this file is
 * written around is specific - `installDom` can leak into a later test file
 * that asserts `typeof window === 'undefined'`, because the global it installs
 * survives the suite unless something puts it back. `bootSdk` therefore
 * deletes the globals it owns on `stop()`, and `bootSdk` is called from a
 * `beforeEach` rather than a `beforeAll` so each test gets a clean document.
 */

import { JSDOM } from 'jsdom'
import { vi } from 'vitest'
import { detectStruggles } from '@/lib/struggle/detect'
import type { ElementBaseline, DetectorContext } from '@/lib/struggle/detect'
import type { RuntimeEvent } from '@/lib/types/events'

/** The globals `installDom` installs, in the order it installs them. */
const INSTALLED_GLOBALS = [
  'window',
  'document',
  'navigator',
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
] as const

export interface SdkRun {
  /** Every event the SDK handed to its buffer, in order. */
  events: RuntimeEvent[]
  /** The document the SDK is watching. */
  doc: Document
  win: Window & typeof globalThis
  /** Restore the Node globals and the real timers. Always call this. */
  stop: () => void
}

function define(key: string, value: unknown): void {
  Object.defineProperty(globalThis, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  })
}

/**
 * A fresh DOM installed as the Node globals.
 *
 * `crypto.subtle` is put on the window because jsdom omits WebCrypto and the
 * SDK hashes element ids through it - that is the API a real browser provides,
 * so the SDK's own code path runs rather than a stubbed one.
 */
export function installDom(html: string, url = 'http://localhost/checkout'): void {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url,
    pretendToBeVisual: true,
  })
  const w = dom.window as unknown as Window & typeof globalThis
  if (!w.crypto?.subtle) {
    Object.defineProperty(w, 'crypto', {
      value: globalThis.crypto,
      writable: true,
      configurable: true,
    })
  }
  define('window', w)
  define('document', w.document)
  define('navigator', w.navigator)
  for (const key of INSTALLED_GLOBALS.slice(3)) {
    define(key, (w as unknown as Record<string, unknown>)[key])
  }
}

/** Put Node's own globals back, so a later file sees no window at all. */
export function uninstallDom(): void {
  for (const key of INSTALLED_GLOBALS) {
    // Deleting is the only honest restore: the SDK's SSR guard tests
    // `typeof window === 'undefined'`, and a `window` set to `undefined` is
    // not the same thing.
    Reflect.deleteProperty(globalThis, key)
  }
}

/**
 * Boot the SDK on a fresh module graph.
 *
 * `initialized` is module scope in the SDK, so a second boot in the same module
 * graph would install no listeners at all and a test would pass or fail on a
 * missing SDK instead of on behaviour. `vi.resetModules()` is what makes each
 * boot real.
 */
export async function bootSdk(html: string, now = 1_700_000_000_000): Promise<SdkRun> {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  installDom(html)
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

  return {
    events,
    doc: globalThis.document,
    win: globalThis.window as unknown as Window & typeof globalThis,
    stop: () => {
      pushSpy.mockRestore()
      fetchSpy.mockRestore()
      flushSpy.mockRestore()
      vi.useRealTimers()
      uninstallDom()
    },
  }
}

/** Advance the SDK's virtual clock, letting its timers fire. */
export async function tick(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

/** A real mousemove through the SDK's own listener. */
export function moveMouse(target?: Element | null): void {
  const el = target ?? globalThis.document.body
  el.dispatchEvent(
    new globalThis.window.MouseEvent('mousemove', { bubbles: true, cancelable: true }),
  )
}

/**
 * A real mouseover through the SDK's own listener.
 *
 * The SDK listens on `mouseover` for hovers (not `mousemove`), so this is what
 * produces a HOVER event. `mouseover` bubbles, which is how the SDK's
 * document-level capture listener sees it.
 */
export function hoverOver(target: Element): void {
  target.dispatchEvent(
    new globalThis.window.MouseEvent('mouseover', { bubbles: true, cancelable: true }),
  )
}

/** A real click through the SDK's own listener. */
export function click(el: Element): void {
  el.dispatchEvent(
    new globalThis.window.MouseEvent('click', { bubbles: true, cancelable: true }),
  )
}

/** A real input event through the SDK's own listener. */
export function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.value = value
  el.dispatchEvent(new globalThis.window.Event('input', { bubbles: true }))
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
