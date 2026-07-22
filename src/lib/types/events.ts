/**
 * Runtime event schema. Versioned from day 1 so the backend can evolve
 * without breaking older SDK installs in the wild.
 */

import type { ElementId } from './ui-map'

export const EVENT_SCHEMA_VERSION = 3 as const

export type EventType =
  | 'CLICK'
  | 'INPUT_CHANGE'
  | 'SUBMIT'
  | 'NAVIGATION'
  | 'HOVER'
  | 'SCROLL'
  | 'DWELL'
  | 'PASTE'
  | 'COPY'
  | 'FOCUS'
  | 'BLUR'
  | 'KEY_DOWN'
  | 'JS_ERROR'
  | 'VALIDATION_ERROR'
  | 'CUSTOM'

/**
 * Page-level context attached to every event so the server can dispatch
 * interventions without having to re-look-up the route's static metadata.
 * Populated by the SDK at init + on navigation.
 */
export interface PageContext {
  title?: string
  h1?: string
  /** Viewport width in CSS pixels. */
  viewportW?: number
  /** Viewport height in CSS pixels. */
  viewportH?: number
  /** Best guess at form factor: 'mobile' (<= 640px), 'tablet' (<= 1024), 'desktop'. */
  formFactor?: 'mobile' | 'tablet' | 'desktop'
  /** Document referrer at first event. */
  referrer?: string
  /** Number of ms the page has been visible (sums across visibility transitions). */
  ageMs?: number
}

/**
 * Element-level context attached when the event source is inside a form,
 * has validation state, or has rich attributes worth sending. Lets the
 * server's detector + dispatcher reason about *this* interaction without
 * needing the full static map at low-latency dispatch time.
 */
export interface ElementContext {
  /** Resolved label / accessible name on the page. */
  label?: string
  /** Inferred role (DISMISS / RETRY / SUBMIT etc). */
  role?: string
  /** Form id / name the element is inside. */
  formId?: string
  /** Form's current `checkValidity()` result. */
  formValid?: boolean
  /** Has the field been touched (focused at least once)? */
  touched?: boolean
  /** Has the field been changed from its default value? */
  dirty?: boolean
  /** For inputs: current length of the value. */
  valueLength?: number
  /** For inputs: validity flags (`valueMissing` / `typeMismatch` etc, comma-joined). */
  validity?: string
  /** True if the element is currently disabled. */
  disabled?: boolean
  /** True if the element has no click/submit/change handler we could detect. */
  dead?: boolean
}

export interface RuntimeEvent {
  schemaVersion: typeof EVENT_SCHEMA_VERSION | 1 | 2
  /** Idempotency key - set by the SDK so retries from the offline buffer are deduped. */
  idempotencyKey: string
  sessionId: string
  /** Hashed user identifier, or null if the user is anonymous. */
  userIdHash: string | null
  elementId: ElementId | null
  route: string
  eventType: EventType
  /** ISO 8601, client-generated. */
  ts: string
  /** Optional, scrubbed metadata. PII regex-masked client-side before send. */
  meta?: Record<string, string | number | boolean | null>
  /** Page context - populated by the SDK at init and on navigation. */
  page?: PageContext
  /** Element context - populated when the event has a clear element source. */
  element?: ElementContext
}

export interface EventBatchRequest {
  schemaVersion: typeof EVENT_SCHEMA_VERSION
  /** SDK-side clock skew estimate vs server, in milliseconds. */
  clockOffsetMs: number
  events: RuntimeEvent[]
}

export interface EventBatchResponse {
  accepted: number
  duplicates: number
  /** Events the server rejected, with reasons. */
  rejected: Array<{ idempotencyKey: string; reason: string }>
  /** Server-dispatched interventions to render right now. */
  interventions?: DispatchedIntervention[]
}

export interface DispatchedIntervention {
  /** Stable id so the SDK can avoid showing the same one twice in one session. */
  id: string
  type: InterventionRenderType
  /** Element to anchor the intervention to (highlight target etc.). */
  targetElementId: ElementId | null
  copy: string
  /** Optional headline / title for richer renderers (modal, banner). */
  title?: string
  /** Renderer-specific options (e.g. anchor: 'top' for tooltip). */
  options?: Record<string, string | number | boolean>
  /** Auto-dismiss after this many ms. 0 = persistent. */
  autoDismissMs?: number
  /** 0–1 confidence the intervention is correct. SDK can use to control prominence. */
  confidence?: number
  /** Element IDs the user might want instead - surfaced as "try this" links. */
  relatedElementIds?: ElementId[]
  /**
   * Diagnostic info for SDK dev mode and dashboard debug panes. Not shown to
   * end users.
   */
  diagnostic?: {
    struggleType: string
    severity: number
    summary?: string
    variantIndex?: number
  }
  /** Secondary copy from LLM enrichment (e.g. semantic helpCopy). */
  helpCopy?: string
}

export type InterventionRenderType =
  | 'OVERLAY'
  | 'HIGHLIGHT'
  | 'TOOLTIP'
  | 'MODAL'
  | 'BANNER'
  | 'INLINE_HINT'
  | 'SPOTLIGHT'
  | 'TOUR'
  | 'ICON_FLASH'
  | 'ARROW'
  | 'CONFIRM'
  | 'ANNOUNCE'

// ─────────────────────────────────────────────────────────────────────────────
// Struggle detection - server is system of record
// ─────────────────────────────────────────────────────────────────────────────

export type StruggleType =
  // Click patterns
  | 'RAGE_CLICK'
  | 'DEAD_CLICK'
  | 'INVALID_CLICK'
  | 'MIS_CLICK'
  // Form patterns
  | 'THRASH'
  | 'BACKTRACK'
  | 'VALIDATION_LOOP'
  | 'ABANDONED_FIELD'
  | 'PASTE_REPEAT'
  | 'REQUIRED_MISSED'
  | 'FORMAT_ERROR'
  | 'PASSWORD_RETRY'
  | 'SLOW_FILL'
  // Navigation patterns
  | 'LOOP'
  | 'SILENT_FAIL'
  | 'BACK_THRASH'
  | 'DEAD_END'
  | 'QUICK_BOUNCE'
  | 'CIRCULAR_NAV'
  // Discovery patterns
  | 'HOVER_HUNT'
  | 'LONG_DWELL'
  | 'RAPID_SCROLL'
  | 'SCROLL_OVERSHOOT'
  | 'IDLE_AFTER_LOAD'
  | 'EMPTY_SEARCH'
  | 'REPEAT_SEARCH'
  | 'ZERO_RESULTS'
  | 'FAILED_FILTER'
  // UI confusion
  | 'MENU_THRASH'
  | 'TOOLTIP_HOVER_REPEAT'
  | 'TAB_HOPPING'
  // Error patterns
  | 'ERROR_DISMISS'
  | 'RETRY_LOOP'
  | 'NOT_FOUND_BOUNCE'
  | 'JS_ERROR'
  // Authentication
  | 'LOGIN_FAILURE'
  | 'LOCKED_OUT'
  // Other
  | 'KEYBOARD_LOST_FOCUS'
  | 'COPY_BOUNCE'
  | 'HELP_HUNT'

export const ALL_STRUGGLE_TYPES: StruggleType[] = [
  'RAGE_CLICK',
  'DEAD_CLICK',
  'INVALID_CLICK',
  'MIS_CLICK',
  'THRASH',
  'BACKTRACK',
  'VALIDATION_LOOP',
  'ABANDONED_FIELD',
  'PASTE_REPEAT',
  'REQUIRED_MISSED',
  'FORMAT_ERROR',
  'PASSWORD_RETRY',
  'SLOW_FILL',
  'LOOP',
  'SILENT_FAIL',
  'BACK_THRASH',
  'DEAD_END',
  'QUICK_BOUNCE',
  'CIRCULAR_NAV',
  'HOVER_HUNT',
  'LONG_DWELL',
  'RAPID_SCROLL',
  'SCROLL_OVERSHOOT',
  'IDLE_AFTER_LOAD',
  'EMPTY_SEARCH',
  'REPEAT_SEARCH',
  'ZERO_RESULTS',
  'FAILED_FILTER',
  'MENU_THRASH',
  'TOOLTIP_HOVER_REPEAT',
  'TAB_HOPPING',
  'ERROR_DISMISS',
  'RETRY_LOOP',
  'NOT_FOUND_BOUNCE',
  'JS_ERROR',
  'LOGIN_FAILURE',
  'LOCKED_OUT',
  'KEYBOARD_LOST_FOCUS',
  'COPY_BOUNCE',
  'HELP_HUNT',
]

export interface StruggleDetection {
  sessionId: string
  elementId: ElementId | null
  type: StruggleType
  /** 0.0 (low confidence) – 1.0 (high confidence). */
  severity: number
  /** Server-assigned timestamp of the originating event window. */
  ts: string
  /** Free-form human-readable summary the dispatcher can use. */
  summary?: string
}

/**
 * Default rule thresholds. Per-element baselines from history will override
 * these; until then, every customer uses the same defaults.
 */
export const DEFAULT_STRUGGLE_RULES = {
  rageClick: { minClicks: 3, windowMs: 2000 },
  deadClick: {
    /** Click on element with no handler and no role; must dwell here this long without nav. */
    dwellMs: 1500,
  },
  misClick: {
    /** Two clicks <300ms apart with cursor moving N pixels = mis-click. */
    proximityPx: 80,
    intervalMs: 300,
  },
  thrash: { minChanges: 5, windowMs: 4000 },
  backtrack: {
    /** Net length grew then shrank then grew this many times. */
    cycles: 3,
    windowMs: 8000,
  },
  validationLoop: {
    /** Submit → validation_error → submit → validation_error pattern this many cycles. */
    cycles: 2,
  },
  abandonedField: {
    /** Focused, typed at least one char, then went idle this long without blur+submit. */
    idleMs: 30_000,
  },
  pasteRepeat: {
    /** Multiple pastes on the same field within window. */
    minPastes: 2,
    windowMs: 5000,
  },
  requiredMissed: { /* triggered by VALIDATION_ERROR meta */ } as const,
  formatError: { /* triggered by VALIDATION_ERROR meta with format issue */ } as const,
  passwordRetry: { minFailures: 2 },
  slowFill: {
    /** Single field receiving sparse keystrokes over a long span. */
    windowMs: 60_000,
    minDuration: 30_000,
  },
  loop: { repeats: 3 },
  silentFail: { windowMs: 8000 },
  backThrash: { minBackEvents: 3, windowMs: 5000 },
  deadEnd: {
    /** Navigated to a route, no further events for this long. */
    idleMs: 20_000,
  },
  quickBounce: { dwellMs: 1500 },
  circularNav: {
    /** A→B→A→B alternation count. */
    cycles: 2,
  },
  hoverHunt: { minHovers: 6, windowMs: 4000 },
  longDwell: { dwellMs: 30_000 },
  rapidScroll: { minScrolls: 5, windowMs: 2000 },
  scrollOvershoot: { reversals: 3, windowMs: 6000 },
  idleAfterLoad: { idleMs: 15_000 },
  emptySearch: {} as const,
  repeatSearch: { minRepeats: 2 },
  zeroResults: {} as const,
  failedFilter: {} as const,
  menuThrash: { minToggles: 3, windowMs: 5000 },
  tooltipHoverRepeat: { minHovers: 3 },
  tabHopping: { minSwitches: 3, windowMs: 8000 },
  errorDismiss: { minDismisses: 2 },
  retryLoop: { minRetries: 2 },
  notFoundBounce: { dwellMs: 3000 },
  jsError: {} as const,
  loginFailure: {} as const,
  lockedOut: { minFailures: 5 },
  keyboardLostFocus: {} as const,
  copyBounce: {
    /** Copy event then nav within window. */
    windowMs: 5000,
  },
  helpHunt: {} as const,
} as const
