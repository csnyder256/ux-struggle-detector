/**
 * Intervention dispatcher - given a list of struggle detections, return the
 * payloads to ship back to the SDK in the /api/events response.
 *
 * Strategy:
 *   1. For each StruggleDetection, look up STRUGGLE_INTERVENTIONS template list.
 *   2. If the list has N > 1 templates, deterministically pick one per session
 *      via `(hash(sessionId, type) % N)` - same session always sees the same
 *      variant for the same struggle type, which is what A/B testing requires.
 *   3. Resolve `{label}` etc. against the involved UIElement's labelRaw.
 *   4. Emit a stable id so the persisted Intervention row matches the SDK's
 *      outcome reports (intervention_shown / dismissed / success).
 *
 * Safety: if `safeMode` is on (default for the first 7 days post-install)
 * the dispatcher returns []. The SDK still collects events.
 */

import { STRUGGLE_INTERVENTIONS, type InterventionTemplate } from './library'
import type {
  DispatchedIntervention,
  InterventionRenderType,
  StruggleDetection,
  StruggleType,
} from '@/lib/types/events'

export interface DispatchContext {
  /** Map elementId → labelRaw (for {label} substitution). Optional. */
  elementLabels?: Map<string, string | null>
  /**
   * Map elementId → enriched semantic name (from the LLM enrichment pass).
   * When present, templates use this instead of the raw label - richer copy
   * out of the box without re-templating.
   */
  elementSemantics?: Map<
    string,
    {
      semanticName: string
      intent?: string
      helpCopy?: string
      alternativeActions?: string[]
    }
  >
  /**
   * Map semanticName (lowercased) → ElementId. Used to resolve LLM-suggested
   * `alternativeActions` text into concrete elements the SDK can highlight.
   */
  semanticNameIndex?: Map<string, string>
  /** Map elementId → validation rules from the static map. */
  elementValidation?: Map<
    string,
    {
      required?: boolean
      minLength?: number
      maxLength?: number
      pattern?: string
      inputType?: string
      min?: number | string
      max?: number | string
    }
  >
  /** Map elementId → semantic role (SUBMIT / DANGER / etc.). */
  elementRoles?: Map<string, string>
  /** When true (default in first 7 days post-install), no interventions render. */
  safeMode: boolean
  /** Skip if SDK already showed this intervention id this session. */
  alreadyShown?: Set<string>
  /** Map sessionId → most-recent route. Used to apply per-route denylist. */
  routeBySession?: Map<string, string>
  /** Routes where interventions never render. Exact string match. */
  routeDenylist?: string[]
  /** Map sessionId → most-recent page title. */
  pageTitleBySession?: Map<string, string>
  /** Map route → static-map title for that route. */
  routeTitles?: Map<string, string>
  /**
   * Bandit feedback signal - Map<rowId, {impressions, successes}>. When supplied
   * the dispatcher does ε-greedy variant selection biased by empirical success
   * rate (with Laplace smoothing). Below `banditMinSamples` total impressions
   * across all variants, the dispatcher falls back to deterministic pick - that
   * keeps tests reproducible AND ensures every variant gets initial exploration.
   */
  variantStats?: Map<string, { impressions: number; successes: number }>
  /** Exploration rate for ε-greedy. Defaults to 0.1. */
  banditEpsilon?: number
  /** Min impressions across all variants before bandit kicks in. Defaults to 30. */
  banditMinSamples?: number
  /** Injected RNG (tests). Defaults to Math.random. */
  random?: () => number
  /**
   * Pre-computed intervention variants per (elementId, struggleType). When
   * present, replaces the in-code template variants for that pair. Keys are
   * `${elementId}|${struggleType}`. The bandit picks a variantIndex into this
   * array exactly as it would for templates.
   */
  cachedVariants?: Map<string, CachedVariant[]>
  /**
   * Route semantic enrichment (Pass 2). Map<routePath, {purpose, journeyStage}>.
   * Used as `{routePurpose}` and `{journeyStage}` template variables.
   */
  routeSemantic?: Map<string, { purpose: string; journeyStage: string }>
}

export interface CachedVariant {
  type: InterventionRenderType
  copy: string
  title?: string | null
  helpCopy?: string | null
  confidence?: number
}

export interface DispatchedInterventionWithRow extends DispatchedIntervention {
  /** Stable Intervention row id; matches the persisted row's id. */
  rowId: string
  /** Variant group identifier (the struggle type). */
  variantGroup: string
  /** Index within the variant group. */
  variantIndex: number
}

export function dispatchInterventions(
  detections: StruggleDetection[],
  ctx: DispatchContext,
): DispatchedIntervention[] {
  return dispatchInterventionsWithRows(detections, ctx).map(
    ({ rowId: _rowId, variantGroup: _vg, variantIndex: _vi, ...d }) => d,
  )
}

/**
 * Lower-level dispatcher that exposes variant metadata so /api/events can
 * persist Intervention rows. The simpler `dispatchInterventions()` above
 * just strips the extra fields.
 */
export function dispatchInterventionsWithRows(
  detections: StruggleDetection[],
  ctx: DispatchContext,
): DispatchedInterventionWithRow[] {
  if (ctx.safeMode) return []
  if (detections.length === 0) return []

  const out: DispatchedInterventionWithRow[] = []
  const usedKeys = new Set<string>()
  const denyset = new Set(ctx.routeDenylist ?? [])

  for (const det of detections) {
    // Apply per-route denylist if we know the session's recent route.
    const route = ctx.routeBySession?.get(det.sessionId)
    if (route && denyset.has(route)) continue

    // Prefer pre-computed variants for this (element, struggleType) pair when
    // available - they're LLM-tailored and skip placeholder rendering.
    const cacheKey = det.elementId ? `${det.elementId}|${det.type}` : null
    const cached = cacheKey ? ctx.cachedVariants?.get(cacheKey) ?? null : null
    const templates = STRUGGLE_INTERVENTIONS[det.type] ?? []
    const variantPool: ReadonlyArray<InterventionTemplate | CachedVariant> =
      cached && cached.length > 0 ? cached : templates
    if (variantPool.length === 0) continue

    let variantIndex = pickVariantBandit(
      det.sessionId,
      det.type,
      det.elementId,
      variantPool.length,
      ctx.variantStats,
      ctx.banditEpsilon ?? 0.1,
      ctx.banditMinSamples ?? 30,
      ctx.random,
    )
    let tmpl = variantPool[variantIndex]!
    let isCached = cached === variantPool

    // Role-aware template override: DANGER / DELETE / LOGOUT actions on a
    // RAGE_CLICK or LONG_DWELL should ask the user to confirm rather than
    // urge them to click again.
    const role = det.elementId ? ctx.elementRoles?.get(det.elementId) : undefined
    if (
      role &&
      (role === 'DANGER' || role === 'DELETE' || role === 'LOGOUT') &&
      (det.type === 'RAGE_CLICK' || det.type === 'LONG_DWELL' || det.type === 'HOVER_HUNT')
    ) {
      // Synthesize a CONFIRM template for destructive struggles.
      tmpl = {
        type: 'CONFIRM',
        copy: 'Heads up - this action is destructive. Are you sure?',
        autoDismissMs: 0,
      } as InterventionTemplate
      variantIndex = -1
      isCached = false
    }
    // Tracking id (session-keyed) for SDK dedup + in-batch dedup.
    const trackingId = sdkTrackingId(det.sessionId, det.type, det.elementId, variantIndex)
    // Population-keyed row id used for DB persistence + bandit stats aggregation.
    const rowId = populationRowId(det.type, det.elementId, variantIndex)
    if (usedKeys.has(trackingId)) continue
    if (ctx.alreadyShown?.has(trackingId)) continue
    usedKeys.add(trackingId)

    // Prefer the enriched semantic name when it's available - that's what
    // the user actually thinks of the element as. Fall back to the raw label
    // (often more verbose / less intent-focused) when no enrichment exists.
    const sem = det.elementId ? ctx.elementSemantics?.get(det.elementId) : null
    const label = sem?.semanticName ?? (det.elementId ? ctx.elementLabels?.get(det.elementId) ?? null : null)
    const intent = sem?.intent ?? null
    const sessRoute = ctx.routeBySession?.get(det.sessionId) ?? ''
    const pageTitle =
      ctx.pageTitleBySession?.get(det.sessionId) ?? ctx.routeTitles?.get(sessRoute) ?? ''
    const validation = det.elementId ? ctx.elementValidation?.get(det.elementId) : undefined
    const validationHint = describeValidation(validation)
    const rsem = sessRoute ? ctx.routeSemantic?.get(sessRoute) : undefined
    const routePurpose = rsem?.purpose ?? ''
    const journeyStage = rsem?.journeyStage ?? ''

    const sem2 = sem ?? null
    const helpCopy = (sem2 as { helpCopy?: string } | null)?.helpCopy ?? null
    const altNames = (sem2 as { alternativeActions?: string[] } | null)?.alternativeActions ?? []
    const relatedElementIds: string[] = []
    if (ctx.semanticNameIndex && altNames.length > 0) {
      for (const name of altNames.slice(0, 5)) {
        const id2 = ctx.semanticNameIndex.get(name.toLowerCase().trim())
        if (id2 && !relatedElementIds.includes(id2)) relatedElementIds.push(id2)
        if (relatedElementIds.length >= 3) break
      }
    }

    // Cached variants are pre-rendered by the LLM - no placeholder substitution.
    // Template variants run through render() to fill in {label}/{validation}.
    const renderVars = {
      label,
      route: sessRoute,
      intent,
      pageTitle,
      validation: validationHint,
      routePurpose,
      journeyStage,
    }
    const renderedCopy = isCached ? tmpl.copy : render(tmpl.copy, renderVars)
    const renderedTitle = tmpl.title
      ? isCached
        ? tmpl.title
        : render(tmpl.title, renderVars)
      : undefined

    // Cached variants may carry their own helpCopy that overrides the
    // semantic-derived one for this specific (element, struggle) pair.
    const cachedHelpCopy = isCached ? (tmpl as CachedVariant).helpCopy ?? null : null
    const finalHelpCopy = cachedHelpCopy ?? helpCopy

    // Cached variants may declare their own confidence; otherwise use the
    // struggle-type heuristic.
    const cachedConfidence =
      isCached && typeof (tmpl as CachedVariant).confidence === 'number'
        ? Math.max(0, Math.min(0.99, (tmpl as CachedVariant).confidence as number))
        : null

    out.push({
      id: trackingId,
      rowId,
      type: tmpl.type,
      variantGroup: det.type,
      variantIndex,
      targetElementId: det.elementId,
      copy: renderedCopy,
      title: renderedTitle,
      options: buildOptions(tmpl as InterventionTemplate),
      autoDismissMs: (tmpl as InterventionTemplate).autoDismissMs ?? 0,
      confidence: cachedConfidence ?? scoreConfidence(det),
      diagnostic: {
        struggleType: det.type,
        severity: det.severity,
        summary: det.summary,
        variantIndex,
      },
      helpCopy: finalHelpCopy ?? undefined,
      relatedElementIds:
        relatedElementIds.length > 0 ? (relatedElementIds as never) : undefined,
    })
  }
  return out
}

/**
 * Confidence: combine struggle severity with the rule's natural reliability.
 * Higher = the SDK should render the intervention more prominently.
 */
function scoreConfidence(det: StruggleDetection): number {
  const HIGH_CONF: Record<string, number> = {
    JS_ERROR: 0.95,
    LOCKED_OUT: 0.9,
    SILENT_FAIL: 0.85,
    NOT_FOUND_BOUNCE: 0.85,
    LOGIN_FAILURE: 0.85,
    REQUIRED_MISSED: 0.8,
    FORMAT_ERROR: 0.8,
    VALIDATION_LOOP: 0.8,
    DEAD_CLICK: 0.8,
    INVALID_CLICK: 0.8,
  }
  const base = HIGH_CONF[det.type] ?? 0.6
  const sevWeight = Math.min(1, det.severity)
  return Math.min(0.99, base * 0.6 + sevWeight * 0.4)
}

function buildOptions(
  tmpl: InterventionTemplate,
): Record<string, string | number | boolean> | undefined {
  const out: Record<string, string | number | boolean> = {}
  if (tmpl.target) out.target = tmpl.target
  if (tmpl.severity) out.severity = tmpl.severity
  return Object.keys(out).length > 0 ? out : undefined
}

function render(
  template: string,
  vars: {
    label: string | null
    route: string
    intent?: string | null
    pageTitle?: string | null
    validation?: string | null
    routePurpose?: string | null
    journeyStage?: string | null
  },
): string {
  return template
    .replace(/\{label\}/g, vars.label ?? 'this')
    .replace(/\{route\}/g, vars.route ?? '')
    .replace(/\{intent\}/g, vars.intent ?? vars.label ?? 'continue')
    .replace(/\{pageTitle\}/g, vars.pageTitle ?? '')
    .replace(/\{validation\}/g, vars.validation ?? '')
    .replace(/\{routePurpose\}/g, vars.routePurpose ?? '')
    .replace(/\{journeyStage\}/g, vars.journeyStage ?? '')
}

interface ValidationLite {
  required?: boolean
  minLength?: number
  maxLength?: number
  pattern?: string
  inputType?: string
  min?: number | string
  max?: number | string
}

/**
 * Convert a ValidationRules object into a single human-readable hint that
 * templates can splice in as `{validation}`.
 */
function describeValidation(v: ValidationLite | undefined): string {
  if (!v) return ''
  const parts: string[] = []
  if (v.required) parts.push('required')
  if (v.inputType === 'email') parts.push('valid email')
  else if (v.inputType === 'url') parts.push('valid URL')
  else if (v.inputType === 'tel') parts.push('valid phone number')
  else if (v.inputType === 'number') {
    if (v.min !== undefined && v.max !== undefined) parts.push(`between ${v.min} and ${v.max}`)
    else if (v.min !== undefined) parts.push(`at least ${v.min}`)
    else if (v.max !== undefined) parts.push(`at most ${v.max}`)
  }
  if (v.minLength) parts.push(`at least ${v.minLength} characters`)
  if (v.maxLength) parts.push(`at most ${v.maxLength} characters`)
  if (v.pattern && !v.inputType) parts.push('a valid format')
  return parts.length > 0 ? `needs ${parts.join(', ')}` : ''
}

/** Deterministic variant pick keyed by session + struggle type (cold start). */
function pickVariantDeterministic(sessionId: string, type: StruggleType, n: number): number {
  if (n <= 1) return 0
  const s = `${sessionId}:${type}`
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h) % n
}

/**
 * ε-greedy bandit variant selection over `n` variants of a struggle type.
 *
 * Cold start: when total impressions across all variants is below `minSamples`
 * we use the deterministic per-session pick. This (a) preserves reproducibility
 * during early traffic, (b) ensures every variant gets some exposure before we
 * start exploiting, and (c) keeps tests deterministic when no stats are passed.
 *
 * Warm: with probability ε we explore (uniform random pick). Otherwise we
 * exploit - pick the variant with the highest Laplace-smoothed empirical
 * success rate `(s + 1) / (i + 2)`. Smoothing breaks ties stably (newer
 * variants with no data still get a fair shake at 0.5 prior).
 */
function pickVariantBandit(
  sessionId: string,
  type: StruggleType,
  elementId: string | null,
  n: number,
  stats: Map<string, { impressions: number; successes: number }> | undefined,
  epsilon: number,
  minSamples: number,
  random: (() => number) | undefined,
): number {
  if (n <= 1) return 0
  const rng = random ?? Math.random
  if (!stats) return pickVariantDeterministic(sessionId, type, n)

  let totalImpressions = 0
  const perVariant: { impressions: number; successes: number }[] = []
  for (let i = 0; i < n; i++) {
    const id = populationRowId(type, elementId, i)
    const s = stats.get(id) ?? { impressions: 0, successes: 0 }
    perVariant.push(s)
    totalImpressions += s.impressions
  }
  if (totalImpressions < minSamples) {
    return pickVariantDeterministic(sessionId, type, n)
  }

  if (rng() < epsilon) {
    return Math.floor(rng() * n) % n
  }

  // Exploit: highest Laplace-smoothed mean.
  let bestIdx = 0
  let bestScore = -1
  for (let i = 0; i < n; i++) {
    const v = perVariant[i]!
    const score = (v.successes + 1) / (v.impressions + 2)
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }
  return bestIdx
}

/**
 * SDK tracking id - session-keyed. Used by the client to dedup "have I shown
 * this intervention yet this session" and by the dispatcher to dedup within
 * a single batch.
 */
function sdkTrackingId(
  sessionId: string,
  type: StruggleType,
  elementId: string | null,
  variantIndex: number,
): string {
  const s = `${sessionId}|${type}|${elementId ?? '_'}|v${variantIndex}`
  let h1 = 0
  let h2 = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = (h1 << 5) - h1 + c
    h2 = (h2 * 31 + c) | 0
    h1 |= 0
  }
  const hex = (Math.abs(h1).toString(16) + Math.abs(h2).toString(16)).slice(0, 16).padEnd(16, '0')
  return `iv_${hex}`
}

/**
 * Population-keyed row id - used for the persisted Intervention row, which
 * aggregates impressions/successes across all sessions. Stripping sessionId
 * is what makes the bandit's stats lookup work: every session's render of
 * (type, element, variant) updates the same row.
 */
function populationRowId(
  type: StruggleType,
  elementId: string | null,
  variantIndex: number,
): string {
  const s = `${type}|${elementId ?? '_'}|v${variantIndex}`
  let h1 = 0
  let h2 = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = (h1 << 5) - h1 + c
    h2 = (h2 * 31 + c) | 0
    h1 |= 0
  }
  const hex = (Math.abs(h1).toString(16) + Math.abs(h2).toString(16)).slice(0, 16).padEnd(16, '0')
  return `iv_${hex}`
}

/** For tests + previews: pull the first template from a struggle type. */
export function templateFor(type: keyof typeof STRUGGLE_INTERVENTIONS): InterventionTemplate {
  const list = STRUGGLE_INTERVENTIONS[type]
  if (!list || list.length === 0) {
    throw new Error(`No intervention template for struggle type ${type}`)
  }
  return list[0]!
}

export function pickVariantIndexForTest(
  sessionId: string,
  type: StruggleType,
  n: number,
): number {
  return pickVariantDeterministic(sessionId, type, n)
}

/** Test-only bandit access. */
export function pickVariantBanditForTest(
  sessionId: string,
  type: StruggleType,
  elementId: string | null,
  n: number,
  stats: Map<string, { impressions: number; successes: number }> | undefined,
  epsilon: number,
  minSamples: number,
  random?: () => number,
): number {
  return pickVariantBandit(sessionId, type, elementId, n, stats, epsilon, minSamples, random)
}

/** Test-only access to the population row id. */
export function populationRowIdForTest(
  type: StruggleType,
  elementId: string | null,
  variantIndex: number,
): string {
  return populationRowId(type, elementId, variantIndex)
}

export type { InterventionRenderType }
