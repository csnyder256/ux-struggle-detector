/**
 * Clarus Heal - runtime SDK.
 *
 * Customer integration is one line:
 *   import { initSelfHealing } from 'clarus-heal'
 *   initSelfHealing({ orgId: '...', endpoint: '/api/events' })
 *
 * The bundled IIFE form (public/sdk.min.js) exposes this as
 * `window.ClarusHeal.initSelfHealing` for script-tag installs.
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
import { RageClickDetector } from './struggle-detector'
import { renderIntervention, setOutcomeCallback } from './renderers'

export interface InitOptions {
  orgId: string
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

/**
 * Module-level handle exposed by `initSelfHealing` so the public `track()` and
 * `identify()` APIs can post events through the same buffer + transport.
 * Reset on init to support hot-reload during dev.
 */
interface SdkState {
  emit: (eventType: EventType, el: Element | null, meta?: RuntimeEvent['meta']) => Promise<unknown>
  setUserIdHash: (hash: string | null) => void
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
  void hashUserIdentifier(userId).then((hash) => _state?.setUserIdHash(hash))
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
  if (initialized) return
  initialized = true
  try {
    initInner(opts)
  } catch (err) {
    // Never crash the host page. Log loudly enough that devs notice during dev
    // but fail closed in production - the host app shouldn't be broken by us.
    // eslint-disable-next-line no-console
    console.warn('[clarus-heal] init failed:', err)
  }
}

function initInner(opts: InitOptions): void {
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
      for (const interv of interventions) renderIntervention(interv)
    },
    opts.ingestKey,
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
        const flags: string[] = []
        const v = el.validity
        if (v?.valueMissing) flags.push('valueMissing')
        if (v?.typeMismatch) flags.push('typeMismatch')
        if (v?.patternMismatch) flags.push('patternMismatch')
        if (v?.tooShort) flags.push('tooShort')
        if (v?.tooLong) flags.push('tooLong')
        if (v?.rangeUnderflow) flags.push('rangeUnderflow')
        if (v?.rangeOverflow) flags.push('rangeOverflow')
        if (v?.stepMismatch) flags.push('stepMismatch')
        if (flags.length > 0) ctx.validity = flags.join(',')
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

  async function emit(
    eventType: EventType,
    el: Element | null,
    meta?: RuntimeEvent['meta'],
  ): Promise<RuntimeEvent | null> {
    if (disabled.has(eventType)) return null
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
      route: location.pathname,
      eventType,
      ts: new Date().toISOString(),
      meta,
      page: snapshotPageContext(),
      element: elementContextFor(el),
    }
    buffer.push(event)
    return event
  }

  // ── Click ────────────────────────────────────────────────────────────────
  document.addEventListener(
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
  document.addEventListener(
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
  document.addEventListener(
    'input',
    (e) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement | null
      if (!target) return
      window.clearTimeout(inputDebounce)
      inputDebounce = window.setTimeout(() => {
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
  document.addEventListener(
    'focus',
    (e) => {
      const target = e.target
      if (!target || !(target instanceof Element)) return
      void emit('FOCUS', target)
    },
    { capture: true, passive: true },
  )
  document.addEventListener(
    'blur',
    (e) => {
      const target = e.target
      if (!target || !(target instanceof Element)) return
      void emit('BLUR', target)
    },
    { capture: true, passive: true },
  )

  // ── Paste / Copy ─────────────────────────────────────────────────────────
  document.addEventListener('paste', (e) => {
    void emit('PASTE', e.target as Element | null)
  }, { capture: true, passive: true })
  document.addEventListener('copy', (e) => {
    void emit('COPY', e.target as Element | null)
  }, { capture: true, passive: true })

  // ── Keydown (Tab navigation only - narrow scope so we don't spam) ───────
  document.addEventListener(
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
  document.addEventListener(
    'mouseover',
    (e) => {
      const target = e.target as Element | null
      if (!target) return
      const interactive =
        target.closest('button, a, input, select, [role="button"], [title], [data-sh-id]') as Element | null
      if (!interactive || interactive === lastHoverEl) return
      lastHoverEl = interactive
      window.clearTimeout(hoverTimer)
      hoverTimer = window.setTimeout(() => {
        const meta: RuntimeEvent['meta'] = {}
        if (interactive.hasAttribute('title')) meta.tooltip = true
        void emit('HOVER', interactive, meta)
      }, 250)
    },
    { capture: true, passive: true },
  )

  // ── Scroll (throttled) ───────────────────────────────────────────────────
  let scrollLastTs = 0
  let scrollLastY = window.scrollY
  window.addEventListener(
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

  // ── Dwell (every 30s, last interactive element) ──────────────────────────
  let lastInteractEl: Element | null = null
  let lastInteractTs = Date.now()
  document.addEventListener(
    'mousemove',
    () => {
      lastInteractTs = Date.now()
    },
    { capture: false, passive: true },
  )
  window.setInterval(() => {
    const dwellMs = Date.now() - lastInteractTs
    if (dwellMs >= 30_000) {
      void emit('DWELL', lastInteractEl, { ms: dwellMs })
    }
  }, 30_000)
  document.addEventListener(
    'mousemove',
    (e) => {
      const t = e.target as Element | null
      if (t) lastInteractEl = t
    },
    { capture: false, passive: true },
  )

  // ── JS errors ────────────────────────────────────────────────────────────
  window.addEventListener('error', (e) => {
    void emit('JS_ERROR', null, {
      message: e.message ?? 'unknown',
      filename: e.filename ?? '',
      lineno: e.lineno ?? 0,
    })
  })
  window.addEventListener('unhandledrejection', (e) => {
    void emit('JS_ERROR', null, {
      message: String((e as PromiseRejectionEvent).reason ?? 'unhandled rejection'),
    })
  })

  // ── Validation errors (custom event the host app can dispatch) ───────────
  document.addEventListener('clarus-heal:validation', ((e: Event) => {
    const detail = (e as CustomEvent).detail ?? {}
    void emit('VALIDATION_ERROR', detail.element ?? null, {
      kind: detail.kind ?? 'format',
      field: detail.field ?? '',
    })
  }) as EventListener)

  // ── Window blur/focus (tab hopping detection) ────────────────────────────
  window.addEventListener('blur', () => {
    void emit('BLUR', null, { target: 'window' })
  })
  window.addEventListener('focus', () => {
    void emit('FOCUS', null, { target: 'window' })
  })

  // ── Navigation ───────────────────────────────────────────────────────────
  void emit('NAVIGATION', null, { trigger: 'initial' })
  window.addEventListener('popstate', () => {
    void emit('NAVIGATION', null, { trigger: 'popstate' })
  })

  // SPA pushState / replaceState patches.
  const _pushState = history.pushState.bind(history)
  history.pushState = function (data: unknown, unused: string, url?: string | URL | null) {
    _pushState(data, unused, url)
    void emit('NAVIGATION', null, { trigger: 'pushstate' })
  } as typeof history.pushState

  // Expose emit + identity setter to the module-level handle so the public
  // track() / identify() APIs route through the same buffer.
  _state = {
    emit: emit as SdkState['emit'],
    setUserIdHash: (h) => {
      userIdHash = h
    },
  }

  // ── Periodic + best-effort flush ────────────────────────────────────────
  window.setInterval(() => void transport.flush(), flushIntervalMs)
  window.addEventListener('beforeunload', () => {
    void transport.flush()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void transport.flush()
  })
}

/**
 * For demos / docs: render any intervention shape directly without going
 * through the event → server → response loop. Production code should not
 * call this - the server is the system of record.
 */
export { renderIntervention } from './renderers'

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

function autoInitFromScriptTag(): void {
  const opts = readAutoInitOptions()
  if (opts) initSelfHealing(opts)
}

// Run on module load. Wrapped so a parse error in the host page doesn't
// destabilize the SDK - initSelfHealing has its own try/catch too.
try {
  autoInitFromScriptTag()
} catch {
  // Ignore - host page may have unusual DOM state.
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
