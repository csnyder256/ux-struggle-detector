/**
 * Server-side struggle detector - pure function over a batch of events.
 *
 * The runtime SDK has its own local detectors for fast UX affordances. The
 * server runs this richer rule set as the system of record: it produces the
 * StruggleEvent rows that populate the friction dashboard and feed the
 * intervention dispatcher.
 *
 * Convention: at most one detection per (sessionId, elementId, type) per
 * pass. The worker that calls us handles persistence + dedup against
 * historical state.
 */

import {
  DEFAULT_STRUGGLE_RULES,
  type RuntimeEvent,
  type StruggleDetection,
  type StruggleType,
} from '@/lib/types/events'
import type { ElementId } from '@/lib/types/ui-map'

/**
 * Per-element baselines computed from session history.
 *
 * The detector uses these to ADAPT thresholds. Static thresholds work for
 * "average" elements but produce false positives on noisy ones (game UIs,
 * undo buttons, fidget toys) and false negatives on calm ones (delete, save,
 * checkout). Per-element learning closes that gap.
 *
 * All fields optional - a partial baseline is still useful.
 */
export interface ElementBaseline {
  /** P95 clicks-per-second observed historically when this element is in use. */
  p95ClicksPerSec?: number | null
  /** P95 dwell duration in ms - typical "look at this without acting" time. */
  p95DwellMs?: number | null
  /** P95 hovers-per-session before a successful click on this element. */
  p95HoversBeforeClick?: number | null
  /** Number of distinct sessions used to compute this baseline. */
  sampleSize?: number
}

export interface DetectorContext {
  baselines?: Map<string, ElementBaseline>
}

export function detectStruggles(
  events: RuntimeEvent[],
  ctx: DetectorContext = {},
): StruggleDetection[] {
  if (events.length === 0) return []
  const sorted = [...events].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  const seen = new Set<string>()
  const out: StruggleDetection[] = []

  // ── click family
  push(out, seen, detectRageClicks(sorted, ctx))
  push(out, seen, detectMisClicks(sorted))
  push(out, seen, detectInvalidClicks(sorted))
  push(out, seen, detectDeadClicks(sorted))

  // ── form family
  push(out, seen, detectThrash(sorted))
  push(out, seen, detectBacktrack(sorted))
  push(out, seen, detectValidationLoop(sorted))
  push(out, seen, detectAbandonedField(sorted))
  push(out, seen, detectPasteRepeat(sorted))
  push(out, seen, detectRequiredMissed(sorted))
  push(out, seen, detectFormatError(sorted))
  push(out, seen, detectPasswordRetry(sorted))
  push(out, seen, detectSlowFill(sorted))

  // ── nav family
  push(out, seen, detectLoops(sorted))
  push(out, seen, detectSilentFails(sorted))
  push(out, seen, detectBackThrash(sorted))
  push(out, seen, detectDeadEnd(sorted))
  push(out, seen, detectQuickBounce(sorted))
  push(out, seen, detectCircularNav(sorted))

  // ── discovery family
  push(out, seen, detectHoverHunt(sorted, ctx))
  push(out, seen, detectLongDwell(sorted, ctx))
  push(out, seen, detectRapidScroll(sorted))
  push(out, seen, detectScrollOvershoot(sorted))
  push(out, seen, detectIdleAfterLoad(sorted))
  push(out, seen, detectEmptySearch(sorted))
  push(out, seen, detectRepeatSearch(sorted))
  push(out, seen, detectZeroResults(sorted))
  push(out, seen, detectFailedFilter(sorted))

  // ── ui confusion
  push(out, seen, detectMenuThrash(sorted))
  push(out, seen, detectTooltipHoverRepeat(sorted))
  push(out, seen, detectTabHopping(sorted))

  // ── errors
  push(out, seen, detectErrorDismiss(sorted))
  push(out, seen, detectRetryLoop(sorted))
  push(out, seen, detectNotFoundBounce(sorted))
  push(out, seen, detectJsError(sorted))

  // ── auth
  push(out, seen, detectLoginFailure(sorted))
  push(out, seen, detectLockedOut(sorted))

  // ── other
  push(out, seen, detectKeyboardLostFocus(sorted))
  push(out, seen, detectCopyBounce(sorted))
  push(out, seen, detectHelpHunt(sorted))

  return out
}

// ── helpers ─────────────────────────────────────────────────────────────────

function dedupKey(sessionId: string, elementId: ElementId | null, type: StruggleType): string {
  return `${sessionId}|${elementId ?? '_'}|${type}`
}

function push(out: StruggleDetection[], seen: Set<string>, dets: StruggleDetection[]) {
  for (const det of dets) {
    const k = dedupKey(det.sessionId, det.elementId, det.type)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(det)
  }
}

function bucketBySessionElement(
  events: RuntimeEvent[],
  filter: (e: RuntimeEvent) => boolean,
): Map<string, RuntimeEvent[]> {
  const buckets = new Map<string, RuntimeEvent[]>()
  for (const e of events) {
    if (!filter(e)) continue
    const key = `${e.sessionId}|${e.elementId ?? '_'}`
    const arr = buckets.get(key) ?? []
    arr.push(e)
    buckets.set(key, arr)
  }
  return buckets
}

function bySession(events: RuntimeEvent[]): Map<string, RuntimeEvent[]> {
  const m = new Map<string, RuntimeEvent[]>()
  for (const e of events) {
    const arr = m.get(e.sessionId) ?? []
    arr.push(e)
    m.set(e.sessionId, arr)
  }
  return m
}

function ts(e: RuntimeEvent): number {
  return Date.parse(e.ts)
}

// ── rules ────────────────────────────────────────────────────────────────────

function detectRageClicks(
  events: RuntimeEvent[],
  ctx: DetectorContext = {},
): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.rageClick
  const out: StruggleDetection[] = []
  const buckets = bucketBySessionElement(events, (e) => e.eventType === 'CLICK')

  for (const clicks of buckets.values()) {
    const sample = clicks[0]
    if (!sample) continue
    // Adapt minClicks to the element's historical click rate. A button that
    // normally takes ~3 clicks/sec from real users (e.g. game UI) shouldn't
    // fire RAGE_CLICK at the static threshold of 3 clicks in 2s. Bump the
    // threshold so we need 1.5x the typical p95 rate sustained for the window.
    let minClicks: number = rule.minClicks
    const baseline = sample.elementId ? ctx.baselines?.get(sample.elementId) : undefined
    if (baseline?.p95ClicksPerSec && baseline.sampleSize && baseline.sampleSize >= 10) {
      const adapted = Math.ceil(baseline.p95ClicksPerSec * (rule.windowMs / 1000) * 1.5)
      minClicks = Math.max(minClicks, adapted)
    }
    if (clicks.length < minClicks) continue
    for (let i = minClicks - 1; i < clicks.length; i++) {
      const start = clicks[i - minClicks + 1]!
      const end = clicks[i]!
      if (ts(end) - ts(start) <= rule.windowMs) {
        out.push({
          sessionId: end.sessionId,
          elementId: end.elementId,
          type: 'RAGE_CLICK',
          severity: Math.min(1, clicks.length / (minClicks * 2)),
          ts: end.ts,
          summary: `${clicks.length} clicks within ${rule.windowMs}ms${minClicks !== rule.minClicks ? ` (adapted threshold: ${minClicks})` : ''}`,
        })
        break
      }
    }
  }
  return out
}

function detectMisClicks(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.misClick
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    const clicks = sess.filter((e) => e.eventType === 'CLICK')
    for (let i = 1; i < clicks.length; i++) {
      const a = clicks[i - 1]!
      const b = clicks[i]!
      if (a.elementId === b.elementId) continue
      if (ts(b) - ts(a) > rule.intervalMs) continue
      out.push({
        sessionId: b.sessionId,
        elementId: b.elementId,
        type: 'MIS_CLICK',
        severity: 0.5,
        ts: b.ts,
        summary: 'Two clicks on different elements within 300ms',
      })
    }
  }
  return out
}

function detectInvalidClicks(events: RuntimeEvent[]): StruggleDetection[] {
  // Fires when SDK marks a click on a disabled element via meta.disabled = true.
  const out: StruggleDetection[] = []
  for (const e of events) {
    if (e.eventType !== 'CLICK') continue
    if (e.element?.disabled !== true && e.meta?.disabled !== true) continue
    out.push({
      sessionId: e.sessionId,
      elementId: e.elementId,
      type: 'INVALID_CLICK',
      severity: 0.6,
      ts: e.ts,
      summary: 'Clicked a disabled element',
    })
  }
  return out
}

function detectDeadClicks(events: RuntimeEvent[]): StruggleDetection[] {
  // Click on an element with no handler → SDK marks meta.dead = true.
  const out: StruggleDetection[] = []
  for (const e of events) {
    if (e.eventType !== 'CLICK') continue
    if (e.element?.dead !== true && e.meta?.dead !== true) continue
    out.push({
      sessionId: e.sessionId,
      elementId: e.elementId,
      type: 'DEAD_CLICK',
      severity: 0.6,
      ts: e.ts,
      summary: 'Clicked a non-interactive element',
    })
  }
  return out
}

function detectThrash(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.thrash
  const out: StruggleDetection[] = []
  const buckets = bucketBySessionElement(
    events,
    (e) => e.eventType === 'INPUT_CHANGE' && e.elementId !== null,
  )
  for (const changes of buckets.values()) {
    if (changes.length < rule.minChanges) continue
    for (let i = rule.minChanges - 1; i < changes.length; i++) {
      const start = changes[i - rule.minChanges + 1]!
      const end = changes[i]!
      if (ts(end) - ts(start) <= rule.windowMs) {
        out.push({
          sessionId: end.sessionId,
          elementId: end.elementId,
          type: 'THRASH',
          severity: Math.min(1, changes.length / (rule.minChanges * 2)),
          ts: end.ts,
          summary: `${changes.length} input changes within ${rule.windowMs}ms`,
        })
        break
      }
    }
  }
  return out
}

function detectBacktrack(events: RuntimeEvent[]): StruggleDetection[] {
  // Detect input length cycle: grew → shrunk → grew. Requires meta.length.
  const rule = DEFAULT_STRUGGLE_RULES.backtrack
  const out: StruggleDetection[] = []
  const buckets = bucketBySessionElement(events, (e) => e.eventType === 'INPUT_CHANGE')
  for (const changes of buckets.values()) {
    if (changes.length < 4) continue
    let cycles = 0
    let direction: 'up' | 'down' | null = null
    let prevLen: number | null = null
    const firstInWindow = changes[0]!
    for (const c of changes) {
      const len = typeof c.meta?.length === 'number' ? c.meta.length : null
      if (len === null) continue
      if (prevLen !== null && len !== prevLen) {
        const newDir = len > prevLen ? 'up' : 'down'
        if (direction !== null && direction !== newDir) cycles++
        direction = newDir
      }
      prevLen = len
    }
    if (cycles >= rule.cycles && ts(changes[changes.length - 1]!) - ts(firstInWindow) <= rule.windowMs) {
      const last = changes[changes.length - 1]!
      out.push({
        sessionId: last.sessionId,
        elementId: last.elementId,
        type: 'BACKTRACK',
        severity: 0.55,
        ts: last.ts,
        summary: `${cycles} write/erase cycles`,
      })
    }
  }
  return out
}

function detectValidationLoop(events: RuntimeEvent[]): StruggleDetection[] {
  // Triggers on: explicit VALIDATION_ERROR cycles, or repeated SUBMIT with
  // form's `checkValidity()` returning false (browser-native rejection).
  const rule = DEFAULT_STRUGGLE_RULES.validationLoop
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    const submits = sess.filter((e) => e.eventType === 'SUBMIT')
    const errors = sess.filter((e) => e.eventType === 'VALIDATION_ERROR')
    const invalidSubmits = submits.filter((e) => e.element?.formValid === false)
    const failedAttempts = Math.max(errors.length, invalidSubmits.length)

    if (submits.length >= rule.cycles && failedAttempts >= rule.cycles) {
      const lastSubmit = submits[submits.length - 1]!
      out.push({
        sessionId: lastSubmit.sessionId,
        elementId: lastSubmit.elementId,
        type: 'VALIDATION_LOOP',
        severity: Math.min(1, failedAttempts / (rule.cycles * 3)),
        ts: lastSubmit.ts,
        summary: `${submits.length} submits, ${failedAttempts} failed attempts`,
      })
    }
  }
  return out
}

function detectAbandonedField(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.abandonedField
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    // Find FOCUS → INPUT_CHANGE → no BLUR/SUBMIT before idle.
    const byElement = new Map<string, RuntimeEvent[]>()
    for (const e of sess) {
      if (!e.elementId) continue
      if (!['FOCUS', 'INPUT_CHANGE', 'BLUR', 'SUBMIT'].includes(e.eventType)) continue
      const arr = byElement.get(e.elementId) ?? []
      arr.push(e)
      byElement.set(e.elementId, arr)
    }
    const lastEventTime = Math.max(...sess.map(ts))
    for (const [, arr] of byElement) {
      const focuses = arr.filter((e) => e.eventType === 'FOCUS')
      const inputs = arr.filter((e) => e.eventType === 'INPUT_CHANGE')
      const blurs = arr.filter((e) => e.eventType === 'BLUR')
      const submits = arr.filter((e) => e.eventType === 'SUBMIT')
      if (focuses.length === 0 || inputs.length === 0) continue
      if (blurs.length > 0 || submits.length > 0) continue
      const lastInput = inputs[inputs.length - 1]!
      if (lastEventTime - ts(lastInput) >= rule.idleMs) {
        out.push({
          sessionId: lastInput.sessionId,
          elementId: lastInput.elementId,
          type: 'ABANDONED_FIELD',
          severity: 0.5,
          ts: lastInput.ts,
          summary: 'Started typing then walked away',
        })
      }
    }
  }
  return out
}

function detectPasteRepeat(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.pasteRepeat
  const out: StruggleDetection[] = []
  const buckets = bucketBySessionElement(events, (e) => e.eventType === 'PASTE')
  for (const arr of buckets.values()) {
    if (arr.length < rule.minPastes) continue
    const start = arr[0]!
    const end = arr[arr.length - 1]!
    if (ts(end) - ts(start) <= rule.windowMs) {
      out.push({
        sessionId: end.sessionId,
        elementId: end.elementId,
        type: 'PASTE_REPEAT',
        severity: 0.5,
        ts: end.ts,
        summary: `${arr.length} paste events`,
      })
    }
  }
  return out
}

function detectRequiredMissed(events: RuntimeEvent[]): StruggleDetection[] {
  const out: StruggleDetection[] = []
  for (const e of events) {
    // Trigger from explicit VALIDATION_ERROR or from native validity flags.
    const fromExplicit = e.eventType === 'VALIDATION_ERROR' && e.meta?.kind === 'required'
    const fromValidity =
      typeof e.element?.validity === 'string' && e.element.validity.includes('valueMissing')
    if (!fromExplicit && !fromValidity) continue
    out.push({
      sessionId: e.sessionId,
      elementId: e.elementId,
      type: 'REQUIRED_MISSED',
      severity: 0.4,
      ts: e.ts,
      summary: 'Required field was missed',
    })
  }
  return out
}

const FORMAT_FLAGS = ['typeMismatch', 'patternMismatch', 'tooShort', 'tooLong', 'rangeUnderflow', 'rangeOverflow', 'stepMismatch']

function detectFormatError(events: RuntimeEvent[]): StruggleDetection[] {
  const out: StruggleDetection[] = []
  for (const e of events) {
    const fromExplicit = e.eventType === 'VALIDATION_ERROR' && e.meta?.kind === 'format'
    const flags = typeof e.element?.validity === 'string' ? e.element.validity.split(',') : []
    const fromValidity = flags.some((f) => FORMAT_FLAGS.includes(f))
    if (!fromExplicit && !fromValidity) continue
    out.push({
      sessionId: e.sessionId,
      elementId: e.elementId,
      type: 'FORMAT_ERROR',
      severity: 0.5,
      ts: e.ts,
      summary:
        flags.length > 0 ? `Native validity: ${flags.join(',')}` : 'Input did not match expected format',
    })
  }
  return out
}

function detectPasswordRetry(events: RuntimeEvent[]): StruggleDetection[] {
  // Multiple SUBMIT events on a form with kind=login that hit VALIDATION_ERROR.
  const rule = DEFAULT_STRUGGLE_RULES.passwordRetry
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    const failures = sess.filter(
      (e) => e.eventType === 'VALIDATION_ERROR' && e.meta?.kind === 'login',
    )
    if (failures.length < rule.minFailures) continue
    const last = failures[failures.length - 1]!
    out.push({
      sessionId: last.sessionId,
      elementId: last.elementId,
      type: 'PASSWORD_RETRY',
      severity: Math.min(1, failures.length / 4),
      ts: last.ts,
      summary: `${failures.length} login failures`,
    })
  }
  return out
}

function detectSlowFill(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.slowFill
  const out: StruggleDetection[] = []
  const buckets = bucketBySessionElement(events, (e) => e.eventType === 'INPUT_CHANGE')
  for (const arr of buckets.values()) {
    if (arr.length < 4) continue
    const span = ts(arr[arr.length - 1]!) - ts(arr[0]!)
    if (span >= rule.minDuration && span <= rule.windowMs) {
      const last = arr[arr.length - 1]!
      out.push({
        sessionId: last.sessionId,
        elementId: last.elementId,
        type: 'SLOW_FILL',
        severity: 0.35,
        ts: last.ts,
        summary: `Filled across ${Math.round(span / 1000)}s`,
      })
    }
  }
  return out
}

function detectLoops(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.loop
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    const navs = sess.filter((e) => e.eventType === 'NAVIGATION')
    const counts = new Map<string, RuntimeEvent[]>()
    for (const n of navs) {
      const arr = counts.get(n.route) ?? []
      arr.push(n)
      counts.set(n.route, arr)
    }
    for (const arr of counts.values()) {
      if (arr.length < rule.repeats) continue
      const last = arr[arr.length - 1]!
      out.push({
        sessionId: last.sessionId,
        elementId: null,
        type: 'LOOP',
        severity: Math.min(1, arr.length / (rule.repeats * 2)),
        ts: last.ts,
        summary: `Visited ${last.route} ${arr.length} times`,
      })
    }
  }
  return out
}

function detectSilentFails(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.silentFail
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    for (let i = 0; i < sess.length; i++) {
      const e = sess[i]!
      if (e.eventType !== 'SUBMIT') continue
      const submitTs = ts(e)
      let hasFollowup = false
      for (let j = i + 1; j < sess.length; j++) {
        const next = sess[j]!
        const dt = ts(next) - submitTs
        if (dt > rule.windowMs) break
        if (dt > 0) {
          hasFollowup = true
          break
        }
      }
      if (!hasFollowup) {
        out.push({
          sessionId: e.sessionId,
          elementId: e.elementId,
          type: 'SILENT_FAIL',
          severity: 0.7,
          ts: e.ts,
          summary: 'Submitted, nothing happened',
        })
      }
    }
  }
  return out
}

function detectBackThrash(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.backThrash
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    const backs = sess.filter(
      (e) => e.eventType === 'NAVIGATION' && e.meta?.trigger === 'popstate',
    )
    if (backs.length < rule.minBackEvents) continue
    const start = backs[0]!
    const end = backs[backs.length - 1]!
    if (ts(end) - ts(start) <= rule.windowMs) {
      out.push({
        sessionId: end.sessionId,
        elementId: null,
        type: 'BACK_THRASH',
        severity: 0.5,
        ts: end.ts,
        summary: `${backs.length} back nav events`,
      })
    }
  }
  return out
}

function detectDeadEnd(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.deadEnd
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    if (sess.length === 0) continue
    const lastEventTime = ts(sess[sess.length - 1]!)
    const navs = sess.filter((e) => e.eventType === 'NAVIGATION')
    if (navs.length === 0) continue
    const lastNav = navs[navs.length - 1]!
    const navTime = ts(lastNav)
    const eventsAfterNav = sess.filter((e) => ts(e) > navTime).length
    if (eventsAfterNav === 0 && lastEventTime - navTime >= rule.idleMs) {
      out.push({
        sessionId: lastNav.sessionId,
        elementId: null,
        type: 'DEAD_END',
        severity: 0.45,
        ts: lastNav.ts,
        summary: `Idle on ${lastNav.route} for ${Math.round((lastEventTime - navTime) / 1000)}s`,
      })
    }
  }
  return out
}

function detectQuickBounce(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.quickBounce
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    const navs = sess.filter((e) => e.eventType === 'NAVIGATION')
    for (let i = 1; i < navs.length; i++) {
      const a = navs[i - 1]!
      const b = navs[i]!
      if (a.route === b.route) continue
      if (ts(b) - ts(a) <= rule.dwellMs) {
        out.push({
          sessionId: b.sessionId,
          elementId: null,
          type: 'QUICK_BOUNCE',
          severity: 0.4,
          ts: b.ts,
          summary: `Left ${a.route} within ${ts(b) - ts(a)}ms`,
        })
      }
    }
  }
  return out
}

function detectCircularNav(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.circularNav
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    const routes = sess.filter((e) => e.eventType === 'NAVIGATION').map((e) => e.route)
    if (routes.length < 4) continue
    let cycles = 0
    for (let i = 3; i < routes.length; i++) {
      if (
        routes[i] === routes[i - 2] &&
        routes[i - 1] === routes[i - 3] &&
        routes[i] !== routes[i - 1]
      ) {
        cycles++
      }
    }
    if (cycles >= rule.cycles) {
      const last = sess.filter((e) => e.eventType === 'NAVIGATION').pop()!
      out.push({
        sessionId: last.sessionId,
        elementId: null,
        type: 'CIRCULAR_NAV',
        severity: 0.55,
        ts: last.ts,
        summary: `Bouncing between ${cycles + 1} routes`,
      })
    }
  }
  return out
}

function detectHoverHunt(
  events: RuntimeEvent[],
  ctx: DetectorContext = {},
): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.hoverHunt
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    const hovers = sess.filter((e) => e.eventType === 'HOVER')
    if (hovers.length < rule.minHovers) continue
    for (let i = rule.minHovers - 1; i < hovers.length; i++) {
      const start = hovers[i - rule.minHovers + 1]!
      const end = hovers[i]!
      // Adapt minHovers: if this element typically gets 8 hovers before a
      // click (e.g. a complex menu), don't fire HOVER_HUNT on the first 8.
      let minHovers: number = rule.minHovers
      const baseline = end.elementId ? ctx.baselines?.get(end.elementId) : undefined
      if (
        baseline?.p95HoversBeforeClick &&
        baseline.sampleSize &&
        baseline.sampleSize >= 10
      ) {
        minHovers = Math.max(rule.minHovers, Math.ceil(baseline.p95HoversBeforeClick * 1.5))
        if (i < minHovers - 1) continue
      }
      if (ts(end) - ts(start) <= rule.windowMs) {
        const followingClicks = sess.filter(
          (e) => e.eventType === 'CLICK' && ts(e) > ts(start) && ts(e) < ts(end) + 500,
        )
        if (followingClicks.length === 0) {
          out.push({
            sessionId: end.sessionId,
            elementId: end.elementId,
            type: 'HOVER_HUNT',
            severity: 0.4,
            ts: end.ts,
            summary: `${hovers.length} hovers without a click${minHovers !== rule.minHovers ? ` (adapted threshold: ${minHovers})` : ''}`,
          })
          break
        }
      }
    }
  }
  return out
}

function detectLongDwell(
  events: RuntimeEvent[],
  ctx: DetectorContext = {},
): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.longDwell
  const out: StruggleDetection[] = []
  for (const e of events) {
    if (e.eventType !== 'DWELL') continue
    const ms = typeof e.meta?.ms === 'number' ? e.meta.ms : 0
    // Adapt threshold: documentation pages, code examples, video pages
    // legitimately attract multi-minute dwells. Bump by 1.5x baseline p95.
    let threshold: number = rule.dwellMs
    const baseline = e.elementId ? ctx.baselines?.get(e.elementId) : undefined
    if (baseline?.p95DwellMs && baseline.sampleSize && baseline.sampleSize >= 10) {
      threshold = Math.max(rule.dwellMs, Math.ceil(baseline.p95DwellMs * 1.5))
    }
    if (ms >= threshold) {
      out.push({
        sessionId: e.sessionId,
        elementId: e.elementId,
        type: 'LONG_DWELL',
        severity: 0.3,
        ts: e.ts,
        summary: `Stared at this for ${Math.round(ms / 1000)}s${threshold !== rule.dwellMs ? ` (adapted threshold: ${Math.round(threshold / 1000)}s)` : ''}`,
      })
    }
  }
  return out
}

function detectRapidScroll(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.rapidScroll
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    const scrolls = sess.filter((e) => e.eventType === 'SCROLL')
    if (scrolls.length < rule.minScrolls) continue
    for (let i = rule.minScrolls - 1; i < scrolls.length; i++) {
      const start = scrolls[i - rule.minScrolls + 1]!
      const end = scrolls[i]!
      if (ts(end) - ts(start) <= rule.windowMs) {
        out.push({
          sessionId: end.sessionId,
          elementId: null,
          type: 'RAPID_SCROLL',
          severity: 0.4,
          ts: end.ts,
          summary: `${scrolls.length} scroll events in ${rule.windowMs}ms`,
        })
        break
      }
    }
  }
  return out
}

function detectScrollOvershoot(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.scrollOvershoot
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    const scrolls = sess
      .filter((e) => e.eventType === 'SCROLL')
      .map((e) => ({ e, dy: typeof e.meta?.dy === 'number' ? e.meta.dy : 0 }))
    if (scrolls.length < 4) continue
    let reversals = 0
    let prevSign = 0
    for (const s of scrolls) {
      const sign = Math.sign(s.dy)
      if (sign !== 0 && prevSign !== 0 && sign !== prevSign) reversals++
      if (sign !== 0) prevSign = sign
    }
    const span = ts(scrolls[scrolls.length - 1]!.e) - ts(scrolls[0]!.e)
    if (reversals >= rule.reversals && span <= rule.windowMs) {
      const last = scrolls[scrolls.length - 1]!.e
      out.push({
        sessionId: last.sessionId,
        elementId: null,
        type: 'SCROLL_OVERSHOOT',
        severity: 0.4,
        ts: last.ts,
        summary: `${reversals} scroll-direction reversals`,
      })
    }
  }
  return out
}

function detectIdleAfterLoad(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.idleAfterLoad
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    if (sess.length === 0) continue
    const initial = sess.find(
      (e) => e.eventType === 'NAVIGATION' && e.meta?.trigger === 'initial',
    )
    if (!initial) continue
    const after = sess.filter((e) => ts(e) > ts(initial))
    const lastEventTime = Math.max(...sess.map(ts))
    if (after.length === 0 && lastEventTime - ts(initial) >= rule.idleMs) {
      out.push({
        sessionId: initial.sessionId,
        elementId: null,
        type: 'IDLE_AFTER_LOAD',
        severity: 0.45,
        ts: initial.ts,
        summary: 'Loaded the page, did nothing',
      })
    }
  }
  return out
}

function detectEmptySearch(events: RuntimeEvent[]): StruggleDetection[] {
  const out: StruggleDetection[] = []
  for (const e of events) {
    if (e.eventType !== 'SUBMIT') continue
    if (e.meta?.kind !== 'search') continue
    if (e.meta?.empty !== true) continue
    out.push({
      sessionId: e.sessionId,
      elementId: e.elementId,
      type: 'EMPTY_SEARCH',
      severity: 0.3,
      ts: e.ts,
      summary: 'Searched with empty query',
    })
  }
  return out
}

function detectRepeatSearch(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.repeatSearch
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    const searches = sess.filter(
      (e) => e.eventType === 'SUBMIT' && e.meta?.kind === 'search',
    )
    const counts = new Map<string, RuntimeEvent[]>()
    for (const s of searches) {
      const q = String(s.meta?.query ?? '')
      const arr = counts.get(q) ?? []
      arr.push(s)
      counts.set(q, arr)
    }
    for (const arr of counts.values()) {
      if (arr.length > rule.minRepeats) {
        const last = arr[arr.length - 1]!
        out.push({
          sessionId: last.sessionId,
          elementId: last.elementId,
          type: 'REPEAT_SEARCH',
          severity: 0.5,
          ts: last.ts,
          summary: `Searched the same query ${arr.length} times`,
        })
      }
    }
  }
  return out
}

function detectZeroResults(events: RuntimeEvent[]): StruggleDetection[] {
  const out: StruggleDetection[] = []
  for (const e of events) {
    if (e.eventType !== 'SUBMIT') continue
    if (e.meta?.kind !== 'search') continue
    if (e.meta?.results !== 0) continue
    out.push({
      sessionId: e.sessionId,
      elementId: e.elementId,
      type: 'ZERO_RESULTS',
      severity: 0.55,
      ts: e.ts,
      summary: 'Search returned zero results',
    })
  }
  return out
}

function detectFailedFilter(events: RuntimeEvent[]): StruggleDetection[] {
  const out: StruggleDetection[] = []
  for (const e of events) {
    if (e.eventType !== 'SUBMIT') continue
    if (e.meta?.kind !== 'filter') continue
    if (e.meta?.results !== 0) continue
    out.push({
      sessionId: e.sessionId,
      elementId: e.elementId,
      type: 'FAILED_FILTER',
      severity: 0.5,
      ts: e.ts,
      summary: 'Filter narrowed to zero',
    })
  }
  return out
}

function detectMenuThrash(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.menuThrash
  const out: StruggleDetection[] = []
  const buckets = bucketBySessionElement(
    events,
    (e) => e.eventType === 'CLICK' && (e.element?.role === 'MENU' || e.meta?.role === 'menu'),
  )
  for (const arr of buckets.values()) {
    if (arr.length < rule.minToggles) continue
    const start = arr[0]!
    const end = arr[arr.length - 1]!
    if (ts(end) - ts(start) <= rule.windowMs) {
      out.push({
        sessionId: end.sessionId,
        elementId: end.elementId,
        type: 'MENU_THRASH',
        severity: 0.45,
        ts: end.ts,
        summary: `Toggled menu ${arr.length} times`,
      })
    }
  }
  return out
}

function detectTooltipHoverRepeat(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.tooltipHoverRepeat
  const out: StruggleDetection[] = []
  const buckets = bucketBySessionElement(
    events,
    (e) => e.eventType === 'HOVER' && e.meta?.tooltip === true,
  )
  for (const arr of buckets.values()) {
    if (arr.length < rule.minHovers) continue
    const last = arr[arr.length - 1]!
    out.push({
      sessionId: last.sessionId,
      elementId: last.elementId,
      type: 'TOOLTIP_HOVER_REPEAT',
      severity: 0.4,
      ts: last.ts,
      summary: `Read the same tooltip ${arr.length} times`,
    })
  }
  return out
}

function detectTabHopping(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.tabHopping
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    const switches = sess.filter(
      (e) =>
        (e.eventType === 'BLUR' && e.meta?.target === 'window') ||
        (e.eventType === 'FOCUS' && e.meta?.target === 'window'),
    )
    if (switches.length < rule.minSwitches) continue
    const start = switches[0]!
    const end = switches[switches.length - 1]!
    if (ts(end) - ts(start) <= rule.windowMs) {
      out.push({
        sessionId: end.sessionId,
        elementId: null,
        type: 'TAB_HOPPING',
        severity: 0.4,
        ts: end.ts,
        summary: `Switched tabs ${switches.length} times`,
      })
    }
  }
  return out
}

function detectErrorDismiss(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.errorDismiss
  const out: StruggleDetection[] = []
  const buckets = bucketBySessionElement(
    events,
    (e) => e.eventType === 'CLICK' && (e.element?.role === 'DISMISS' || e.meta?.role === 'dismiss'),
  )
  for (const arr of buckets.values()) {
    if (arr.length < rule.minDismisses) continue
    const last = arr[arr.length - 1]!
    out.push({
      sessionId: last.sessionId,
      elementId: last.elementId,
      type: 'ERROR_DISMISS',
      severity: 0.5,
      ts: last.ts,
      summary: `Dismissed the same error ${arr.length} times`,
    })
  }
  return out
}

function detectRetryLoop(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.retryLoop
  const out: StruggleDetection[] = []
  const buckets = bucketBySessionElement(
    events,
    (e) => e.eventType === 'CLICK' && (e.element?.role === 'RETRY' || e.meta?.role === 'retry'),
  )
  for (const arr of buckets.values()) {
    if (arr.length < rule.minRetries) continue
    const last = arr[arr.length - 1]!
    out.push({
      sessionId: last.sessionId,
      elementId: last.elementId,
      type: 'RETRY_LOOP',
      severity: 0.55,
      ts: last.ts,
      summary: `Hit retry ${arr.length} times`,
    })
  }
  return out
}

function detectNotFoundBounce(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.notFoundBounce
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    const navs = sess.filter((e) => e.eventType === 'NAVIGATION')
    for (let i = 0; i < navs.length; i++) {
      const e = navs[i]!
      if (!e.route.match(/(^|\/)(404|not[-_]found)\b/i)) continue
      const next = navs[i + 1]
      if (next && ts(next) - ts(e) <= rule.dwellMs) {
        out.push({
          sessionId: e.sessionId,
          elementId: null,
          type: 'NOT_FOUND_BOUNCE',
          severity: 0.6,
          ts: e.ts,
          summary: `Hit ${e.route} and bounced`,
        })
      }
    }
  }
  return out
}

function detectJsError(events: RuntimeEvent[]): StruggleDetection[] {
  const out: StruggleDetection[] = []
  for (const e of events) {
    if (e.eventType !== 'JS_ERROR') continue
    out.push({
      sessionId: e.sessionId,
      elementId: e.elementId,
      type: 'JS_ERROR',
      severity: 0.7,
      ts: e.ts,
      summary: typeof e.meta?.message === 'string' ? e.meta.message : 'Uncaught JS error',
    })
  }
  return out
}

function detectLoginFailure(events: RuntimeEvent[]): StruggleDetection[] {
  const out: StruggleDetection[] = []
  for (const e of events) {
    if (e.eventType !== 'VALIDATION_ERROR') continue
    if (e.meta?.kind !== 'login') continue
    out.push({
      sessionId: e.sessionId,
      elementId: e.elementId,
      type: 'LOGIN_FAILURE',
      severity: 0.5,
      ts: e.ts,
      summary: 'Login attempt failed',
    })
  }
  return out
}

function detectLockedOut(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.lockedOut
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    const failures = sess.filter(
      (e) => e.eventType === 'VALIDATION_ERROR' && e.meta?.kind === 'login',
    )
    if (failures.length >= rule.minFailures) {
      const last = failures[failures.length - 1]!
      out.push({
        sessionId: last.sessionId,
        elementId: last.elementId,
        type: 'LOCKED_OUT',
        severity: 0.85,
        ts: last.ts,
        summary: `${failures.length} login failures - likely locked out`,
      })
    }
  }
  return out
}

function detectKeyboardLostFocus(events: RuntimeEvent[]): StruggleDetection[] {
  // FOCUS → BLUR within < 500ms with no INPUT_CHANGE in between, on an input.
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    for (let i = 0; i < sess.length - 1; i++) {
      const a = sess[i]!
      if (a.eventType !== 'FOCUS') continue
      const b = sess.slice(i + 1).find((e) => e.elementId === a.elementId)
      if (!b || b.eventType !== 'BLUR') continue
      const between = sess
        .slice(i + 1)
        .filter((e) => e === b ? false : e.elementId === a.elementId && ts(e) < ts(b))
      if (between.length === 0 && ts(b) - ts(a) < 500) {
        out.push({
          sessionId: a.sessionId,
          elementId: a.elementId,
          type: 'KEYBOARD_LOST_FOCUS',
          severity: 0.3,
          ts: a.ts,
          summary: 'Focused, then lost focus before typing',
        })
      }
    }
  }
  return out
}

function detectCopyBounce(events: RuntimeEvent[]): StruggleDetection[] {
  const rule = DEFAULT_STRUGGLE_RULES.copyBounce
  const out: StruggleDetection[] = []
  const sessions = bySession(events)
  for (const sess of sessions.values()) {
    for (let i = 0; i < sess.length; i++) {
      const e = sess[i]!
      if (e.eventType !== 'COPY') continue
      const next = sess.slice(i + 1).find((n) => n.eventType === 'NAVIGATION')
      if (next && ts(next) - ts(e) <= rule.windowMs) {
        out.push({
          sessionId: e.sessionId,
          elementId: e.elementId,
          type: 'COPY_BOUNCE',
          severity: 0.35,
          ts: e.ts,
          summary: 'Copied, then left',
        })
      }
    }
  }
  return out
}

function detectHelpHunt(events: RuntimeEvent[]): StruggleDetection[] {
  const out: StruggleDetection[] = []
  for (const e of events) {
    if (e.eventType !== 'CLICK') continue
    if (e.element?.role !== 'HELP' && e.meta?.role !== 'help') continue
    out.push({
      sessionId: e.sessionId,
      elementId: e.elementId,
      type: 'HELP_HUNT',
      severity: 0.4,
      ts: e.ts,
      summary: 'Clicked help / support',
    })
  }
  return out
}
