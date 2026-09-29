/**
 * Clarus Heal - runtime SDK.
 *
 * Customer integration is one script tag carrying `data-org-id` (see
 * readAutoInitOptions below), or, after loading the bundle (public/sdk.min.js):
 *   ClarusHeal.initSelfHealing({ orgId: '...', endpoint: 'https://.../api/events' })
 *
 * It is framework-agnostic: it listens at the document level, follows
 * history-mode and hash-mode routers (see ./route), and is a no-op when
 * called during server-side rendering.
 *
 * Captures: click, submit, input, paste, copy, focus, blur, key down, hover,
 * scroll, dwell, navigation, JS errors, and "validation_error" custom events.
 * Renders server-dispatched interventions inline (highlight, tooltip, modal,
 * banner, inline hint, spotlight, icon flash, arrow, confirm, announce).
 * Local rage-click fallback overlay still fires when offline / pre-pipeline.
 */

import {
  EVENT_SCHEMA_VERSION,
  type ElementContext,
  type EventType,
  type PageContext,
  type RuntimeEvent,
} from '../lib/types/events'
import type { ElementId } from '../lib/types/ui-map'
import { resolveElementId } from './element-id'
import { scrubText } from './scrubber'
import { EventBuffer } from './event-buffer'
import { Transport } from './transport'
import { RageClickDetector, type DetectorResult } from './struggle-detector'
import { renderIntervention, setOutcomeCallback, resetRenderers } from './renderers'
import { NavigationTracker, classifyPopstate, routeFromLocation, type NavigationTrigger } from './route'

export interface InitOptions {
  orgId: string
  /** Observe the event actually accepted into the local buffer. No input values are included. */
  onEvent?: (event: RuntimeEvent) => void
  /** Local rule evidence; the production server remains the system of record. */
  onLocalStruggle?: (result: Extract<DetectorResult, { detected: true }>) => void
  /** Where to POST event batches. Default `/api/events`. Use `'console'` for local demos. */
  endpoint?: string
  /** Default 4000ms. */
  flushIntervalMs?: number
  /**
   * Show a placeholder overlay when the local rage-click rule fires before
   * the server can dispatch one. Recommended ON.
   */
  enableLocalDemoOverlays?: boolean
  /** Extra PII regex patterns to scrub from input values. */
  piiPatterns?: RegExp[]
  /** Disable a specific event type entirely. Useful for high-traffic apps. */
  disableEventTypes?: EventType[]
  /**
   * Per-org bearer ingest key (`ck_...`). Generated at /dashboard/settings.
   * Required when the server is configured with REQUIRE_INGEST_KEY=true.
   */
  ingestKey?: string
  /**
   * Sampling configuration. Reduces event volume on high-traffic apps.
   *
   * Three forms:
   *   - `0.1` (number) - accept 10% of events uniformly
   *   - `(eventType, el) => boolean` - accept by predicate
   *   - `{ default: 0.5, byType: { CLICK: 1, SCROLL: 0.05 } }` - per-type
   *
   * `JS_ERROR`, `VALIDATION_ERROR`, and intervention outcome events ALWAYS
   * pass through regardless of sampling - they're cheap and load-bearing.
   */
  sampling?:
    | number
    | ((eventType: EventType, el: Element | null) => boolean)
    | { default?: number; byType?: Partial<Record<EventType, number>> }
}

let initialized = false
let cleanup: (() => void) | null = null

/**
 * Module-level handle exposed by `initSelfHealing` so the public `track()` and
 * `identify()` APIs can post events through the same buffer + transport.
 * Reset on init to support hot-reload during dev.
 */
interface SdkState {
  emit: (eventType: EventType, el: Element | null, meta?: RuntimeEvent['meta']) => Promise<unknown>
  setUserIdHash: (hash: string | null) => void
  flush: () => Promise<import('./transport').FlushResult>
}
let _state: SdkState | null = null

/**
 * Tag a key business event (signup, purchase, plan upgrade) so it appears in
 * the dashboard alongside automatic UI events. Custom-event names + props are
 * routed as CUSTOM events with `meta.kind = 'track'`.
 */
export function track(name: string, props?: Record<string, string | number | boolean>): void {
  if (!_state) {
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('[clarus-heal] track() called before initSelfHealing()')
    }
    return
  }
  const meta: Record<string, string | number | boolean | null> = { kind: 'track', name }
  if (props) for (const k of Object.keys(props)) meta[k] = props[k] ?? null
  void _state.emit('CUSTOM', null, meta)
}

/**
 * Associate the current session with a stable user identifier. The plaintext
 * id is HASHED before storage - we never persist raw user identifiers.
 * Subsequent events carry the hashed id so the dashboard can compute MAU.
 */
export function identify(userId: string): void {
  if (!_state) return
  const current = _state
  void hashUserIdentifier(userId).then((hash) => {
    if (_state === current) current.setUserIdHash(hash)
  }).catch(() => undefined)
}

async function hashUserIdentifier(userId: string): Promise<string> {
  const data = new TextEncoder().encode(userId)
  const buf = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(buf)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, '0')
  // Truncate to first 32 hex chars (128-bit) - collision-resistant + privacy-friendly.
  return hex.slice(0, 32)
}

export function initSelfHealing(opts: InitOptions): void {
  // Frameworks that render on the server (Next, Nuxt, SvelteKit, Remix,
  // Angular SSR) may run this during the server pass. There is nothing to
  // observe there, and marking the SDK initialized would be wrong in any
  // runtime that shares module state with the client, so bail out first.
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (initialized) return
  if (!opts.orgId?.trim()) return
  if (opts.flushIntervalMs !== undefined && (!Number.isFinite(opts.flushIntervalMs) || opts.flushIntervalMs <= 0)) return
  initialized = true
  try {
    initInner(opts)
  } catch (err) {
    // Never crash the host page. Log loudly enough that devs notice during dev
    // but fail closed in production - the host app shouldn't be broken by us.
    // eslint-disable-next-line no-console
    console.warn('[clarus-heal] init failed:', err)
    destroySelfHealing()
  }
}

/** Stop collection, timers, pending responses and SDK interventions. Reinitialization is supported. */
export function destroySelfHealing(): void {
  cleanup?.()
  cleanup = null
  _state = null
  initialized = false
  if (typeof document !== 'undefined') resetRenderers()
}

/** Flush after all already queued element hashes have settled. */
export async function flush(): Promise<import('./transport').FlushResult> {
  return _state ? _state.flush() : { sent: 0 }
}

function initInner(opts: InitOptions): void {
  let active = true
  const controller = new window.AbortController()
  const timers = new Set<number>()
  const intervals = new Set<number>()
  const restorers: Array<() => void> = []
  cleanup = () => {
    active = false
    controller.abort()
    for (const id of timers) window.clearTimeout(id)
    for (const id of intervals) window.clearInterval(id)
    for (const restore of restorers) restore()
    setOutcomeCallback(null)
  }
  // Keep the native overloads, including keyboard/mouse event types.
  const doc = { addEventListener: ((type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => {
    document.addEventListener(type, listener, { ...(typeof options === 'boolean' ? { capture: options } : options), signal: controller.signal })
  }) as Document['addEventListener'] }
  const win = { addEventListener: ((type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => {
    window.addEventListener(type, listener, { ...(typeof options === 'boolean' ? { capture: options } : options), signal: controller.signal })
  }) as Window['addEventListener'] }
  function after(fn: () => void, ms: number): number {
    const id = window.setTimeout(() => { timers.delete(id); if (active) fn() }, ms)
    timers.add(id)
    return id
  }
  function every(fn: () => void, ms: number): number {
    const id = window.setInterval(() => { if (active) fn() }, ms)
    intervals.add(id)
    return id
  }

  const endpoint = opts.endpoint ?? '/api/events'
  const flushIntervalMs = opts.flushIntervalMs ?? 4000
  const sessionId = ensureSessionId()
  const disabled = new Set<EventType>(opts.disableEventTypes ?? [])

  const buffer = new EventBuffer()
  const transport = new Transport(
    opts.orgId,
    endpoint,
    buffer,
    0,
    (interventions) => {
      if (active) for (const interv of interventions) renderIntervention(interv)
    },
    opts.ingestKey,
    controller.signal,
  )
  const rage = new RageClickDetector()

  // ── Page context (refreshed on navigation) ──────────────────────────────
  const pageMountedAt = Date.now()
  const initialReferrer = document.referrer
  function snapshotPageContext(): PageContext {
    const w = window.innerWidth
    const h = window.innerHeight
    const formFactor: PageContext['formFactor'] =
      w <= 640 ? 'mobile' : w <= 1024 ? 'tablet' : 'desktop'
    const h1 = document.querySelector('h1')?.textContent?.trim() ?? undefined
    return {
      title: document.title || undefined,
      h1: h1 ? h1.slice(0, 200) : undefined,
      viewportW: w,
      viewportH: h,
      formFactor,
      referrer: initialReferrer || undefined,
      ageMs: Date.now() - pageMountedAt,
    }
  }

  // ── Element context ──────────────────────────────────────────────────────
  function elementContextFor(el: Element | null): ElementContext | undefined {
    if (!el) return undefined
    const ctx: ElementContext = {}
    const text = (el.textContent ?? '').trim()
    if (text && text.length < 80) ctx.label = text
    const aria = el.getAttribute('aria-label')
    if (aria) ctx.label = aria
    const role = inferRole(el)
    if (role) ctx.role = role

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      ctx.touched = true
      const defaultVal =
        el instanceof HTMLSelectElement
          ? Array.from(el.options).find((o) => o.defaultSelected)?.value ?? ''
          : el.defaultValue
      ctx.dirty = el.value !== defaultVal
      if ('value' in el && typeof el.value === 'string') ctx.valueLength = el.value.length
      if (el.disabled) ctx.disabled = true
      if (typeof el.checkValidity === 'function' && !el.checkValidity()) {
        const v = el.validity
        const byFlag = new Map<string, boolean>([
          ['valueMissing', Boolean(v?.valueMissing)],
          ['typeMismatch', Boolean(v?.typeMismatch)],
          ['patternMismatch', Boolean(v?.patternMismatch)],
          ['tooShort', Boolean(v?.tooShort)],
          ['tooLong', Boolean(v?.tooLong)],
          ['rangeUnderflow', Boolean(v?.rangeUnderflow)],
          ['rangeOverflow', Boolean(v?.rangeOverflow)],
          ['stepMismatch', Boolean(v?.stepMismatch)],
          // Only a real browser has `badInput` and lets a page set a custom
          // message; both are worth sending because a page's own message is
          // better copy than anything reconstructed from attributes.
          ['badInput', Boolean(v?.badInput)],
          ['customError', Boolean(v?.customError)],
        ])
        const flags = Array.from(byFlag).filter(([, on]) => on).map(([name]) => name)
        if (flags.length > 0) ctx.validity = flags.join(',')
        // The message the page itself gave the field. This is the only place it
        // can be captured: after a reload the string is gone, so if we do not
        // send it with the validation failure, no server-side copy can recover it.
        if (v?.customError) {
          const message = el.validationMessage?.trim()
          if (message) {
            // Custom errors can echo the field's value. Mask that echo before
            // applying the configured PII scrubber, then enforce the wire size.
            const value = el.value ?? ''
            const withoutValue = value ? message.split(value).join('[redacted]') : message
            ctx.validationMessage = scrubText(withoutValue, opts.piiPatterns).slice(0, 200)
          }
        }
      }
    }
    if (el instanceof HTMLButtonElement && el.disabled) ctx.disabled = true

    const form = (el as HTMLInputElement).form ?? el.closest('form')
    if (form) {
      ctx.formId = form.id || form.getAttribute('name') || '(unnamed-form)'
      try {
        ctx.formValid = form.checkValidity()
      } catch {
        // some browsers throw on certain forms
      }
    }

    if (!hasHandler(el)) ctx.dead = true

    return Object.keys(ctx).length > 0 ? ctx : undefined
  }

  // Wire intervention outcome → event stream so the server can aggregate
  // impression / dismissed / success counts on the Interventions dashboard.
  setOutcomeCallback((interventionId, outcome) => {
    void emit('CUSTOM', null, {
      kind: `intervention_${outcome}`,
      iid: interventionId,
    })
  })

  function makeIdempotencyKey(): string {
    const rand = Math.random().toString(36).slice(2, 10)
    return `${sessionId}_${Date.now()}_${rand}`
  }

  let userIdHash: string | null = null

  // Always-passes event types - cheap, load-bearing, never sampled out.
  const samplingExempt = new Set<EventType>(['JS_ERROR', 'VALIDATION_ERROR'])

  function shouldSample(eventType: EventType, el: Element | null): boolean {
    const cfg = opts.sampling
    if (cfg === undefined) return true
    // Outcome events (CUSTOM with intervention_*) are exempt - they're how
    // we measure intervention effectiveness.
    if (samplingExempt.has(eventType)) return true
    if (typeof cfg === 'number') {
      return cfg >= 1 ? true : cfg <= 0 ? false : Math.random() < cfg
    }
    if (typeof cfg === 'function') {
      try {
        return cfg(eventType, el) !== false
      } catch {
        return true
      }
    }
    const perType = cfg.byType?.[eventType]
    const rate = typeof perType === 'number' ? perType : cfg.default ?? 1
    return rate >= 1 ? true : rate <= 0 ? false : Math.random() < rate
  }

  /**
   * Tail of the emit chain. `resolveElementId` is async (it hashes through
   * `crypto.subtle`), so two emits in flight can finish in the opposite order
   * and land in the buffer reversed - and the buffer is the ordered record the
   * server detector reads. Chaining the whole emit, not just the buffer push,
   * is what makes the completion order the call order; serializing only the
   * push would still let the faster hash overtake the slower one.
   */
  let emitChain: Promise<unknown> = Promise.resolve()

  function emit(
    eventType: EventType,
    el: Element | null,
    meta?: RuntimeEvent['meta'],
  ): Promise<RuntimeEvent | null> {
    if (!disabled.has(eventType) && interactEventTypes.has(eventType)) {
      noteInteractElement(eventType, el)
      if (eventType !== 'HOVER') markActivity()
    }
    const run = emitChain.then(() => emitNow(eventType, el, meta))
    // Keep the chain alive even if one emit fails, so a single bad event does
    // not wedge every later one.
    emitChain = run.catch(() => undefined)
    return run
  }

  async function emitNow(
    eventType: EventType,
    el: Element | null,
    meta?: RuntimeEvent['meta'],
  ): Promise<RuntimeEvent | null> {
    if (!active || disabled.has(eventType)) return null
    // Which element a later DWELL will name. A disabled event type is not an
    // interaction the SDK recorded, so it does not move the pointer either.
    // Intervention outcome events (CUSTOM with meta.kind = 'intervention_*')
    // are also exempt regardless of sampling.
    const isOutcome =
      eventType === 'CUSTOM' &&
      typeof meta?.kind === 'string' &&
      meta.kind.startsWith('intervention_')
    if (!isOutcome && !shouldSample(eventType, el)) return null
    let elementId: ElementId | null = null
    if (el) {
      try {
        elementId = await resolveElementId(opts.orgId, el)
      } catch {
        elementId = null
      }
    }
    const event: RuntimeEvent = {
      schemaVersion: EVENT_SCHEMA_VERSION,
      idempotencyKey: makeIdempotencyKey(),
      sessionId,
      userIdHash,
      elementId,
      route: routeFromLocation(location),
      eventType,
      ts: new Date().toISOString(),
      meta,
      page: snapshotPageContext(),
      element: elementContextFor(el),
    }
    if (!active) return null
    buffer.push(event)
    try { opts.onEvent?.(JSON.parse(JSON.stringify(event)) as RuntimeEvent) } catch { /* Observers cannot break collection. */ }
    return event
  }

  // ── Click ────────────────────────────────────────────────────────────────
  doc.addEventListener(
    'click',
    (e) => {
      const target = e.target as Element | null
      if (!target) return
      const interactive =
        (target.closest(
          'button, a, input, select, textarea, [role="button"], [data-sh-id]',
        ) as Element | null) ?? target
      const meta: RuntimeEvent['meta'] = {}
      if ((interactive as HTMLButtonElement).disabled) meta.disabled = true
      if (!hasHandler(interactive)) meta.dead = true
      const role = inferRole(interactive)
      if (role) meta.role = role
      void emit('CLICK', interactive, meta).then((ev) => {
        if (!ev) return
        const result = rage.observe(ev.elementId)
        if (result.detected) {
          try { opts.onLocalStruggle?.(result) } catch { /* Isolate host callback failures. */ }
        }
        if (result.detected && opts.enableLocalDemoOverlays) {
          renderIntervention({
            id: `local_${Date.now()}`,
            type: 'HIGHLIGHT',
            targetElementId: ev.elementId,
            copy: 'Looks like you&rsquo;re having trouble with this. Take a breath - we&rsquo;re working on it.',
            options: { style: 'pulse' },
            autoDismissMs: 6000,
          })
        }
      })
    },
    { capture: true, passive: true },
  )

  // ── Submit ───────────────────────────────────────────────────────────────
  doc.addEventListener(
    'submit',
    (e) => {
      const form = e.target as HTMLFormElement | null
      const meta: RuntimeEvent['meta'] = {}
      if (form) {
        const kind = form.getAttribute('data-sh-form-kind')
        if (kind) meta.kind = kind
        const empty = formIsEmpty(form)
        if (empty) meta.empty = true
      }
      void emit('SUBMIT', form, meta)
    },
    { capture: true, passive: true },
  )

  // ── Input change (debounced + scrubbed) ──────────────────────────────────
  let inputDebounce: number | undefined
  const inputElementMeta = new Map<Element, { lastLength: number }>()
  doc.addEventListener(
    'input',
    (e) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement | null
      if (!target) return
      window.clearTimeout(inputDebounce)
      inputDebounce = after(() => {
        const value = scrubText(target.value ?? '', opts.piiPatterns)
        const length = value.length
        const prev = inputElementMeta.get(target)?.lastLength ?? 0
        inputElementMeta.set(target, { lastLength: length })
        void emit('INPUT_CHANGE', target, { length, delta: length - prev })
      }, 300)
    },
    { capture: true, passive: true },
  )

  // ── Focus / Blur ─────────────────────────────────────────────────────────
  doc.addEventListener(
    'focus',
    (e) => {
      const target = e.target
      if (!target || !(target instanceof Element)) return
      void emit('FOCUS', target)
    },
    { capture: true, passive: true },
  )
  doc.addEventListener(
    'blur',
    (e) => {
      const target = e.target
      if (!target || !(target instanceof Element)) return
      void emit('BLUR', target)
    },
    { capture: true, passive: true },
  )

  // ── Paste / Copy ─────────────────────────────────────────────────────────
  doc.addEventListener('paste', (e) => {
    void emit('PASTE', e.target as Element | null)
  }, { capture: true, passive: true })
  doc.addEventListener('copy', (e) => {
    void emit('COPY', e.target as Element | null)
  }, { capture: true, passive: true })

  // ── Keydown (Tab navigation only - narrow scope so we don't spam) ───────
  doc.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Tab' && e.key !== 'Escape' && e.key !== 'Enter') return
      void emit('KEY_DOWN', e.target as Element | null, { key: e.key })
    },
    { capture: true, passive: true },
  )

  // ── Hover (debounced; only on interactive-ish elements) ──────────────────
  let hoverTimer: number | undefined
  let lastHoverEl: Element | null = null
  doc.addEventListener(
    'mouseover',
    (e) => {
      const target = e.target as Element | null
      if (!target) return
      const interactive =
        target.closest('button, a, input, select, [role="button"], [title], [data-sh-id]') as Element | null
      if (!interactive || interactive === lastHoverEl) return
      lastHoverEl = interactive
      window.clearTimeout(hoverTimer)
      hoverTimer = after(() => {
        const meta: RuntimeEvent['meta'] = {}
        if (interactive.hasAttribute('title')) meta.tooltip = true
        // A hover names its element, but only once the dwell that follows is
        // actually reported - see `pendingHoverEl`. The event itself is emitted
        // with a null element ID on purpose: hover is not a click, and hashing
        // the element would put an `elementId` on HOVER events that the per-
        // element baselines and the friction tables would then read as a real
        // interaction with that element.
        pendingHoverEl = interactive
        void emit('HOVER', null, meta)
      }, 250)
    },
    { capture: true, passive: true },
  )

  // ── Scroll (throttled) ───────────────────────────────────────────────────
  let scrollLastTs = 0
  let scrollLastY = window.scrollY
  win.addEventListener(
    'scroll',
    () => {
      const now = Date.now()
      if (now - scrollLastTs < 200) return
      scrollLastTs = now
      const dy = window.scrollY - scrollLastY
      scrollLastY = window.scrollY
      void emit('SCROLL', null, { dy })
    },
    { capture: false, passive: true },
  )

  // ── Dwell (checked every second, reported at 10/30s … and re-armed) ──────
  // The threshold is 15-30s and a per-element baseline can raise it further,
  // so the check is far cheaper than the threshold; waking every 1s turns
  // "stared at a page and did nothing" from up to 30s late into ~1s late. A
  // 30s tick also handed out a free verification reset: any progress at all
  // within 30s looked idle. The interval itself is not the signal, so it must
  // never be what the threshold is compared against.
  /**
   * The element a DWELL report is *about*: the element the user was last
   * interacting with when they went quiet. `noteInteractElement` below decides
   * which events qualify; this is only the display copy of that decision.
   *
   * Every real interaction other than a hover moves this pointer, because the
   * element a long dwell belongs to is not always the element the pointer
   * happens to be resting on. A user who reads a page after clicking a button,
   * or who types into a field and then stops, was staring at *that* element;
   * carrying a stale hover would attribute the quiet stretch - and the
   * `LONG_DWELL` row built from it - to whatever the mouse last glided over,
   * usually a decorative block with no interaction at all.
   */
  let lastInteractEl: Element | null = null
  let lastStrongInteractEl: Element | null = null
  /**
   * Where the deferred `mousemove` update will land. A hover is the weakest
   * possible evidence of which element a dwell belongs to (moving the mouse
   * across the page is not an interaction with anything), so it is applied
   * last rather than winning every race against the events that are. Without
   * this, one pointer twitch mid-stretch reassigns the whole report.
   */
  let pendingHoverEl: Element | null = null
  let lastInteractTs = Date.now()
  /** Quiet time worth reporting as a dwell. Below the 15-30s rules on purpose
   *  so an adapted baseline still has a reported number to act on. */
  const DWELL_REPORT_MS = 10_000
  /**
   * Whether a DWELL has already been emitted for the quiet stretch currently
   * in progress. The timer wakes every second, so without this a single idle
   * period would re-fire on every later tick and feed the per-element dwell
   * baseline duplicates of itself. It cannot be "did the timer reset
   * lastInteractTs": the tick that carries the report has already read
   * `lastInteractTs` by then, and a report that lands late in a stretch must
   * describe the whole stretch, not just the time since the previous report.
   */
  let reportedThisStretch = false
  /** The stretch length already reported in the current quiet period. */
  let lastReportedMs = 0
  /**
   * Identity of the quiet stretch currently in progress. Every DWELL report
   * for one stretch carries the same value, and a resumed interaction mints a
   * new one. The server's per-element dwell baseline groups reports by this id
   * and takes ONE sample per stretch, so a single 120s stare that was reported
   * 111 times does not out-vote 111 separate 10s stares. Distinct ms values
   * are not a substitute: the reports of one stretch are all distinct by
   * construction, which is exactly what made counting rows look safe.
   */
  let stretchSeq = 0
  let stretchId = `st_${Date.now().toString(36)}_0`
  function markActivity(): void {
    lastInteractTs = Date.now()
    reportedThisStretch = false
    // A new stretch gets a new id; the next report of THIS stretch is the
    // first of its life, so `lastReportedMs` resets with it.
    stretchSeq += 1
    lastReportedMs = 0
    stretchId = `st_${Date.now().toString(36)}_${stretchSeq}`
  }
  /**
   * The event types that say "the user was working with this element": typing,
   * pasting, submitting, clicking, focusing. `noteInteractElement` turns each
   * into the element the SDK already resolved the event against, which is the
   * one the server stores on the DWELL event and therefore the one the
   * per-element dwell baseline and the intervention dispatcher both key on.
   */
  const interactEventTypes = new Set<EventType>([
    'CLICK',
    'INPUT_CHANGE',
    'SUBMIT',
    'PASTE',
    'FOCUS',
    'HOVER',
  ])
  doc.addEventListener(
    'mousemove',
    (e) => {
      pendingHoverEl = e.target as Element | null
      markActivity()
    },
    { capture: false, passive: true },
  )
  /**
   * Which element a DWELL names.
   *
   * A hover names its target; anything else that is an interaction with an
   * element goes through `emit`, which already resolved the element ID for the
   * event it is sending. Reading it back from there keeps the dwell target and
   * the event target the same object, instead of walking the DOM a second time
   * and risking a different answer.
   */
  function noteInteractElement(eventType: EventType, el: Element | null): void {
    if (el) {
      lastStrongInteractEl = el
      lastInteractEl = el
      return
    }
    // Only a hover may reach here with `null`: every other type in the set
    // reads its target straight off the click / submit / input / paste / focus
    // event, so a null there means there is genuinely nothing to name and the
    // previous element should stand rather than be cleared.
    if (eventType === 'HOVER' && !lastStrongInteractEl && pendingHoverEl) lastInteractEl = pendingHoverEl
  }
  every(() => {
    const quietMs = Date.now() - lastInteractTs
    // The stretch is measured from the last real interaction or from the start
    // of this stretch, whichever is later - never from a report that merely
    // reset the timer, or a two-minute stare would be reported as 10s.
    const stretchMs = reportedThisStretch ? lastReportedMs + quietMs : quietMs
    if (stretchMs >= DWELL_REPORT_MS) {
      noteInteractElement('HOVER', null)
      // `stretch` identifies the quiet stretch this report belongs to, so the
      // server can count one sample per stretch instead of one per heartbeat.
      void emit('DWELL', lastInteractEl, { ms: stretchMs, stretch: stretchId })
      // Report the quiet stretch once, then carry on measuring it.
      lastReportedMs = stretchMs
      lastInteractTs = Date.now()
      reportedThisStretch = true
    }
  }, 1000)
  // ── JS errors ────────────────────────────────────────────────────────────
  win.addEventListener('error', (e) => {
    void emit('JS_ERROR', null, {
      message: e.message ?? 'unknown',
      filename: e.filename ?? '',
      lineno: e.lineno ?? 0,
    })
  })
  win.addEventListener('unhandledrejection', (e) => {
    void emit('JS_ERROR', null, {
      message: String((e as PromiseRejectionEvent).reason ?? 'unhandled rejection'),
    })
  })

  // ── Validation errors (custom event the host app can dispatch) ───────────
  doc.addEventListener('clarus-heal:validation', ((e: Event) => {
    const detail = (e as CustomEvent).detail ?? {}
    void emit('VALIDATION_ERROR', detail.element ?? null, {
      kind: detail.kind ?? 'format',
      field: detail.field ?? '',
    })
  }) as EventListener)

  // ── Window blur/focus (tab hopping detection) ────────────────────────────
  win.addEventListener('blur', () => {
    void emit('BLUR', null, { target: 'window' })
  })
  win.addEventListener('focus', () => {
    void emit('FOCUS', null, { target: 'window' })
  })

  // ── Navigation ───────────────────────────────────────────────────────────
  const navigation = new NavigationTracker(location)
  function navigated(trigger: NavigationTrigger): void {
    if (navigation.shouldRecord(trigger, location)) {
      lastStrongInteractEl = null
      lastInteractEl = null
      pendingHoverEl = null
      markActivity()
      void emit('NAVIGATION', null, { trigger })
    }
  }
  void emit('NAVIGATION', null, { trigger: 'initial' })
  // The Navigation API (where present) fires `navigate` before `popstate`
  // and says whether the move was a traversal or a new entry.
  let lastNavigationType: string | null = null
  const navigationApi = (window as { navigation?: EventTarget }).navigation
  navigationApi?.addEventListener('navigate', ((e: Event & { navigationType?: string }) => {
    lastNavigationType = e.navigationType ?? null
  }) as EventListener, { signal: controller.signal })
  win.addEventListener('popstate', () => {
    const trigger = classifyPopstate(lastNavigationType)
    lastNavigationType = null
    navigated(trigger)
  })
  // Hash-mode routers move by changing the fragment.
  win.addEventListener('hashchange', () => navigated('hashchange'))

  // SPA pushState / replaceState patches. Some routers navigate with
  // replaceState (redirects, `replace: true` links); NavigationTracker
  // ignores the many replaceState calls that do not change the URL.
  const originalPush = history.pushState
  const _pushState = originalPush.bind(history)
  history.pushState = function (data: unknown, unused: string, url?: string | URL | null) {
    _pushState(data, unused, url)
    navigated('pushstate')
  } as typeof history.pushState
  const patchedPush = history.pushState
  const originalReplace = history.replaceState
  const _replaceState = originalReplace.bind(history)
  history.replaceState = function (data: unknown, unused: string, url?: string | URL | null) {
    _replaceState(data, unused, url)
    navigated('replacestate')
  } as typeof history.replaceState

  const patchedReplace = history.replaceState
  restorers.push(() => {
    if (history.pushState === patchedPush) history.pushState = originalPush
    if (history.replaceState === patchedReplace) history.replaceState = originalReplace
  })

  // Expose emit + identity setter to the module-level handle so the public
  // track() / identify() APIs route through the same buffer.
  _state = {
    emit: emit as SdkState['emit'],
    flush: async () => { await emitChain; return active ? transport.flush() : { sent: 0 } },
    setUserIdHash: (h) => {
      userIdHash = h
    },
  }

  // ── Periodic + best-effort flush ────────────────────────────────────────
  every(() => void transport.flush(), flushIntervalMs)
  win.addEventListener('beforeunload', () => {
    void transport.flush()
  })
  doc.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void transport.flush()
  })
}

/**
 * For demos / docs: render any intervention shape directly without going
 * through the event → server → response loop. Production code should not
 * call this - the server is the system of record.
 */
export { renderIntervention } from './renderers'
export { startTour, type TourOptions, type TourStep, type TourHandle } from './tours'

/**
 * Script-tag auto-init.
 *
 * Customers drop one line in their HTML:
 *   <script src=".../sdk.min.js" data-org-id="org_..." data-ingest-key="ck_..."></script>
 *
 * This walks the DOM for a script tag carrying `data-org-id` and calls
 * `initSelfHealing` with the attributes, so customers don't need a second
 * `<script>` block. `document.currentScript` works for synchronous loads;
 * for async/defer we fall back to a scan.
 */
/**
 * Test-injectable interface for the script-tag auto-init reader. The real
 * call uses the browser `document`; tests pass a stub.
 */
export interface AutoInitDocument {
  currentScript: { dataset: Record<string, string | undefined> } | null
  scripts: Array<{ dataset: Record<string, string | undefined> }>
}

export function readAutoInitOptions(doc?: AutoInitDocument): InitOptions | null {
  let source: AutoInitDocument | null = doc ?? null
  if (!source) {
    if (typeof document === 'undefined') return null
    source = {
      currentScript: document.currentScript as unknown as AutoInitDocument['currentScript'],
      scripts: Array.from(
        document.querySelectorAll<HTMLScriptElement>('script[data-org-id]'),
      ) as unknown as AutoInitDocument['scripts'],
    }
  }
  let candidate: AutoInitDocument['currentScript'] = null
  if (source.currentScript && source.currentScript.dataset.orgId) {
    candidate = source.currentScript
  } else if (source.scripts.length > 0) {
    candidate = source.scripts[source.scripts.length - 1] ?? null
  }
  if (!candidate) return null
  const orgId = candidate.dataset.orgId
  if (!orgId) return null
  const ingestKey = candidate.dataset.ingestKey || undefined
  const endpoint = candidate.dataset.endpoint || undefined
  const flushIntervalMsRaw = candidate.dataset.flushIntervalMs
  const flushIntervalMs = flushIntervalMsRaw ? Number(flushIntervalMsRaw) : undefined
  return {
    orgId,
    ingestKey,
    endpoint,
    flushIntervalMs: Number.isFinite(flushIntervalMs) ? flushIntervalMs : undefined,
  }
}

function ensureSessionId(): string {
  const KEY = '__sh_sid_v1__'
  try {
    const existing = sessionStorage.getItem(KEY)
    if (existing) return existing
  } catch {
    // storage disabled
  }
  const id = `sh_sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  try {
    sessionStorage.setItem(KEY, id)
  } catch {
    // ignore
  }
  return id
}

function hasHandler(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (['button', 'a', 'input', 'select', 'textarea', 'form'].includes(tag)) return true
  if (el.hasAttribute('onclick') || el.hasAttribute('role')) return true
  if (el.hasAttribute('data-sh-id')) return true
  return false
}

function inferRole(el: Element): string | null {
  const cls = (el.getAttribute('class') ?? '').toLowerCase()
  const label = (el.textContent ?? '').toLowerCase()
  if (cls.includes('dismiss') || cls.includes('close') || /×|✕/.test(label)) return 'dismiss'
  if (cls.includes('retry') || /retry|try again/.test(label)) return 'retry'
  if (/^help|support|contact/.test(label) || cls.includes('help')) return 'help'
  if (cls.includes('menu') || el.hasAttribute('aria-haspopup')) return 'menu'
  return null
}

function formIsEmpty(form: HTMLFormElement): boolean {
  for (const el of Array.from(form.elements)) {
    const e = el as HTMLInputElement
    if (!e.name) continue
    if (e.type === 'submit' || e.type === 'button' || e.type === 'hidden') continue
    if (e.value && e.value.trim().length > 0) return false
  }
  return true
}
