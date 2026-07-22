/**
 * Event ingest endpoint - called by the runtime SDK to deliver event batches.
 *
 * Auth (MVP): the SDK passes `X-Org-Id` in the request headers. In open-access
 * mode the demo Org id works for everyone. In auth mode this is replaced with
 * a per-org `IngestKey` (HMAC-signed), Phase 14.
 *
 * What this endpoint does on each batch:
 *   1. Validate + persist events with idempotency dedup.
 *   2. Run the synchronous struggle detector on the batch.
 *   3. Persist new StruggleEvent rows (best-effort).
 *   4. Dispatch interventions (gated by org safeMode) and return them inline
 *      so the SDK can render right away.
 *
 * Latency budget: ≤ 200ms p50 in dev. The detector is pure-functional so it
 * scales linearly with batch size. The DB writes happen after the dispatch
 * payload is computed, so a slow DB doesn't delay the user-visible feedback.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import {
  ALL_STRUGGLE_TYPES,
  EVENT_SCHEMA_VERSION,
  type EventBatchResponse,
  type RuntimeEvent,
  type StruggleType,
} from '@/lib/types/events'
import { detectStruggles } from '@/lib/struggle/detect'
import { dispatchInterventionsWithRows } from '@/lib/interventions/dispatcher'
import { ingestKeyRequired, resolveIngestToken } from '@/lib/auth/ingest'
import { bumpUsage, trackActiveUsers } from '@/lib/usage/track'

const STRUGGLE_TYPE_SET = new Set<string>(ALL_STRUGGLE_TYPES)

const PageContextSchema = z
  .object({
    title: z.string().max(500).optional(),
    h1: z.string().max(500).optional(),
    viewportW: z.number().int().nonnegative().optional(),
    viewportH: z.number().int().nonnegative().optional(),
    formFactor: z.enum(['mobile', 'tablet', 'desktop']).optional(),
    referrer: z.string().max(2048).optional(),
    ageMs: z.number().int().nonnegative().optional(),
  })
  .passthrough()
  .optional()

const ElementContextSchema = z
  .object({
    label: z.string().max(500).optional(),
    role: z.string().max(40).optional(),
    formId: z.string().max(120).optional(),
    formValid: z.boolean().optional(),
    touched: z.boolean().optional(),
    dirty: z.boolean().optional(),
    valueLength: z.number().int().nonnegative().optional(),
    validity: z.string().max(200).optional(),
    disabled: z.boolean().optional(),
    dead: z.boolean().optional(),
  })
  .passthrough()
  .optional()

const SCHEMA_VERSION_LITERAL = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(EVENT_SCHEMA_VERSION),
])

const RuntimeEventSchema = z.object({
  schemaVersion: SCHEMA_VERSION_LITERAL,
  idempotencyKey: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  userIdHash: z.string().nullable(),
  elementId: z
    .string()
    .regex(/^sh_[0-9a-f]{32}$/)
    .nullable(),
  route: z.string().min(1).max(2048),
  eventType: z.enum([
    'CLICK',
    'INPUT_CHANGE',
    'SUBMIT',
    'NAVIGATION',
    'HOVER',
    'SCROLL',
    'DWELL',
    'PASTE',
    'COPY',
    'FOCUS',
    'BLUR',
    'KEY_DOWN',
    'JS_ERROR',
    'VALIDATION_ERROR',
    'CUSTOM',
  ]),
  ts: z.string().datetime(),
  meta: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  page: PageContextSchema,
  element: ElementContextSchema,
})

const BatchSchema = z.object({
  schemaVersion: SCHEMA_VERSION_LITERAL,
  clockOffsetMs: z.number(),
  events: z.array(RuntimeEventSchema).max(500),
})

// Event types that have first-class storage in the DB enum. HOVER + DWELL
// went in for Phase 25 so the per-element baselines worker has real signal
// for `p95DwellMs` and `p95HoversBeforeClick`. Keep this set in sync with
// the `EventType` enum in `prisma/schema.prisma`.
const KNOWN_DB_EVENT_TYPES = new Set([
  'CLICK',
  'INPUT_CHANGE',
  'SUBMIT',
  'NAVIGATION',
  'HOVER',
  'DWELL',
  'CUSTOM',
])

export async function POST(req: NextRequest) {
  // Resolve the org via either: (a) Authorization: Bearer ck_... ingest key,
  // (b) X-Org-Id (dev mode only). REQUIRE_INGEST_KEY=true rejects the latter.
  let orgId: string | null = null
  const authHeader = req.headers.get('authorization')
  const bearer =
    authHeader && authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : null
  if (bearer) {
    const resolved = await resolveIngestToken(bearer)
    if (!resolved) {
      return NextResponse.json(
        { error: 'Invalid or revoked ingest key.' },
        { status: 401, headers: corsHeaders() },
      )
    }
    orgId = resolved.orgId
  } else if (!ingestKeyRequired()) {
    orgId = req.headers.get('x-org-id')
  }
  if (!orgId) {
    return NextResponse.json(
      {
        error: ingestKeyRequired()
          ? 'Missing Authorization: Bearer ingest key.'
          : 'Missing X-Org-Id header.',
      },
      { status: 401, headers: corsHeaders() },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON.' },
      { status: 400, headers: corsHeaders() },
    )
  }

  const parsed = BatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid batch.', issues: parsed.error.flatten() },
      { status: 400, headers: corsHeaders() },
    )
  }

  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { id: true },
  })
  if (!org) {
    return NextResponse.json(
      { error: 'Unknown org.' },
      { status: 404, headers: corsHeaders() },
    )
  }

  // ── Persist events (dedup via the unique (orgId, idempotencyKey)). ────────
  // Only event types backed by the DB enum can go in. Others (HOVER, SCROLL,
  // etc.) are still useful to the detector - we keep them in memory below.
  const persistable = parsed.data.events.filter((e) => KNOWN_DB_EVENT_TYPES.has(e.eventType))
  const inserts = persistable.map((e) => ({
    orgId,
    sessionId: e.sessionId,
    userIdHash: e.userIdHash,
    elementId: e.elementId,
    route: e.route,
    eventType: e.eventType as
      | 'CLICK'
      | 'INPUT_CHANGE'
      | 'SUBMIT'
      | 'NAVIGATION'
      | 'HOVER'
      | 'DWELL'
      | 'CUSTOM',
    ts: new Date(e.ts),
    meta: (e.meta ?? {}) as never,
    idempotencyKey: e.idempotencyKey,
    schemaVersion: e.schemaVersion,
  }))

  let accepted = 0
  if (inserts.length > 0) {
    try {
      const result = await prisma.userEvent.createMany({
        data: inserts,
        skipDuplicates: true,
      })
      accepted = result.count
    } catch {
      // Logged at the platform layer; keep going so interventions still run.
    }
  }
  const duplicates = inserts.length - accepted

  // ── Hydrate recent events from the DB for the sessions in this batch so
  //    cross-batch rules (LOOP, BACK_THRASH, CIRCULAR_NAV, IDLE_AFTER_LOAD,
  //    DEAD_END, COPY_BOUNCE…) actually fire. Only persistable event types are
  //    in the DB, but those cover the patterns that span batches.
  const sessionIdsInBatch = Array.from(new Set(parsed.data.events.map((e) => e.sessionId)))
  const lookbackMs = 5 * 60 * 1000 // 5 minutes
  const lookbackSince = new Date(Date.now() - lookbackMs)
  const seenIdempotencyKeys = new Set(parsed.data.events.map((e) => e.idempotencyKey))
  const dbEvents =
    sessionIdsInBatch.length > 0
      ? await prisma.userEvent.findMany({
          where: {
            orgId,
            sessionId: { in: sessionIdsInBatch },
            ts: { gte: lookbackSince },
          },
          orderBy: { ts: 'asc' },
          take: 1000,
        })
      : []
  const hydrated: RuntimeEvent[] = dbEvents
    .filter(
      (e) => !e.idempotencyKey || !seenIdempotencyKeys.has(e.idempotencyKey),
    )
    .map((e) => ({
      schemaVersion: 2,
      idempotencyKey: e.idempotencyKey ?? `db_${e.id}`,
      sessionId: e.sessionId,
      userIdHash: e.userIdHash,
      elementId: e.elementId as RuntimeEvent['elementId'],
      route: e.route,
      eventType: e.eventType as RuntimeEvent['eventType'],
      ts: e.ts.toISOString(),
      meta: ((e as { meta?: unknown }).meta ?? {}) as RuntimeEvent['meta'],
    }))

  const allEvents: RuntimeEvent[] = [...hydrated, ...(parsed.data.events as RuntimeEvent[])]

  // Pull per-element baselines from the static map. The detector uses these
  // to adapt thresholds - noisy elements (game UI) need a higher RAGE_CLICK
  // threshold, calm ones (delete) need a lower one.
  const elementIdsInBatch = Array.from(
    new Set(
      allEvents
        .map((e) => e.elementId as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  )
  const baselines = new Map<string, { p95ClicksPerSec?: number | null; sampleSize?: number }>()
  if (elementIdsInBatch.length > 0) {
    try {
      const baseEls = (await prisma.uIElement.findMany({
        where: { id: { in: elementIdsInBatch } },
        select: { id: true, extraction: true } as never,
      })) as Array<{ id: string; extraction: Record<string, unknown> | null }>
      for (const el of baseEls) {
        const ext = (el.extraction ?? {}) as {
          baseline?: { p95ClicksPerSec?: number | null; sampleSize?: number }
        }
        if (ext.baseline) baselines.set(el.id, ext.baseline)
      }
    } catch {
      // Baselines are optional; detector falls back to static thresholds.
    }
  }

  const detections = detectStruggles(allEvents, { baselines })

  // ── Persist struggle events (best effort).
  for (const d of detections) {
    if (!STRUGGLE_TYPE_SET.has(d.type)) continue
    try {
      await prisma.struggleEvent.create({
        data: {
          orgId,
          sessionId: d.sessionId,
          elementId: d.elementId,
          type: d.type as StruggleType as never,
          severity: d.severity,
          ts: new Date(d.ts),
        },
      })
    } catch {
      // Schema enum may not have all values yet (pre-migration). Ignore.
    }
  }

  // ── Outcome events from previously-shown interventions.
  // The SDK fires these as CUSTOM events with meta.kind = "intervention_shown" /
  // "intervention_dismissed" / "intervention_success" and meta.iid = row id.
  const outcomeEvents = parsed.data.events.filter(
    (e) =>
      e.eventType === 'CUSTOM' &&
      typeof e.meta?.kind === 'string' &&
      typeof e.meta?.iid === 'string' &&
      (e.meta.kind === 'intervention_shown' ||
        e.meta.kind === 'intervention_dismissed' ||
        e.meta.kind === 'intervention_success'),
  )
  for (const e of outcomeEvents) {
    const iid = String(e.meta!.iid)
    const kind = String(e.meta!.kind)
    try {
      const incData =
        kind === 'intervention_shown'
          ? { impressions: { increment: 1 } }
          : kind === 'intervention_success'
            ? { successes: { increment: 1 } }
            : { dismissals: { increment: 1 } }
      const updated = await prisma.intervention.update({
        where: { id: iid },
        data: incData,
        select: { impressions: true, successes: true },
      })
      if (updated.impressions > 0) {
        await prisma.intervention.update({
          where: { id: iid },
          data: { successRate: updated.successes / updated.impressions },
        })
      }
      // Persist a per-session impression record for richer aggregations.
      await prisma.interventionImpression.create({
        data: {
          orgId,
          interventionId: iid,
          sessionId: e.sessionId,
          variant: null,
          outcome:
            kind === 'intervention_success'
              ? 'SUCCESS'
              : kind === 'intervention_dismissed'
                ? 'DISMISSED'
                : 'ABANDON',
          ts: new Date(e.ts),
        },
      })
    } catch {
      // Row missing or dup - ignore.
    }
  }

  // ── Dispatch interventions.
  const config = await prisma.platformConfig.findUnique({
    where: { orgId },
  })
  const safeMode = config?.safeMode ?? true
  // routeDenylist is a Json column added in the latest migration. Cast for
  // pre-regen Prisma clients.
  const denyRaw = (config as { routeDenylist?: unknown } | null | undefined)?.routeDenylist
  const routeDenylist = Array.isArray(denyRaw)
    ? (denyRaw as unknown[]).filter((r): r is string => typeof r === 'string')
    : []

  // Build the latest-route-by-session + page-title-by-session maps.
  const routeBySession = new Map<string, string>()
  const pageTitleBySession = new Map<string, string>()
  for (const e of allEvents) {
    if (e.eventType === 'NAVIGATION') {
      routeBySession.set(e.sessionId, e.route)
    } else if (!routeBySession.has(e.sessionId)) {
      routeBySession.set(e.sessionId, e.route)
    }
    const t = e.page?.title
    if (t) pageTitleBySession.set(e.sessionId, t)
  }

  // Hydrate route titles for any routes appearing in this batch (so the
  // dispatcher can use {pageTitle} even when the SDK didn't send one), AND
  // route semantic enrichment (Pass 2) for {routePurpose} / {journeyStage}.
  const routeSet = new Set(routeBySession.values())
  const routeTitleRows =
    routeSet.size > 0
      ? await prisma.uIRoute.findMany({
          where: { orgId, path: { in: Array.from(routeSet) } },
          select: { path: true, title: true, extraction: true } as never,
        })
      : []
  const routeTitles = new Map<string, string>()
  const routeSemantic = new Map<string, { purpose: string; journeyStage: string }>()
  for (const r of routeTitleRows as Array<{
    path: string
    title: string | null
    extraction: Record<string, unknown> | null
  }>) {
    if (r.title) routeTitles.set(r.path, r.title)
    const ext = (r.extraction ?? {}) as {
      routeSemantic?: { purpose?: string; journeyStage?: string }
    }
    const rs = ext.routeSemantic
    if (rs?.purpose && rs.journeyStage) {
      routeSemantic.set(r.path, { purpose: rs.purpose, journeyStage: rs.journeyStage })
    }
  }

  const elementIds = Array.from(
    new Set(detections.flatMap((d) => (d.elementId ? [d.elementId as string] : []))),
  )
  const elementsWithSemantics =
    elementIds.length > 0
      ? ((await prisma.uIElement.findMany({
          where: { id: { in: elementIds } },
          select: {
            id: true,
            labelRaw: true,
            semanticRole: true,
            extraction: true,
            semantics: {
              orderBy: { enrichedAt: 'desc' },
              take: 1,
              select: {
                semanticName: true,
                intent: true,
                extraction: true,
              } as never,
            },
          } as never,
        })) as Array<{
          id: string
          labelRaw: string | null
          semanticRole: string | null
          extraction: Record<string, unknown> | null
          semantics: Array<{
            semanticName: string
            intent: string
            extraction: Record<string, unknown> | null
          }>
        }>)
      : []
  const labelMap = new Map(elementsWithSemantics.map((l) => [l.id, l.labelRaw]))
  const elementRoles = new Map<string, string>()
  const elementValidation = new Map<
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
  >()
  for (const el of elementsWithSemantics) {
    if (el.semanticRole) elementRoles.set(el.id, el.semanticRole)
    const ex = el.extraction as { validation?: typeof elementValidation extends Map<string, infer V> ? V : never } | null
    if (ex?.validation) elementValidation.set(el.id, ex.validation)
  }
  const semanticMap = new Map<
    string,
    { semanticName: string; intent?: string; helpCopy?: string; alternativeActions?: string[] }
  >()
  for (const el of elementsWithSemantics) {
    const sem = el.semantics[0]
    if (sem) {
      const ex = (sem.extraction ?? {}) as {
        helpCopy?: string
        alternativeActions?: string[]
      }
      semanticMap.set(el.id, {
        semanticName: sem.semanticName,
        intent: sem.intent,
        helpCopy: ex.helpCopy,
        alternativeActions: ex.alternativeActions,
      })
    }
  }

  // Build a global index of semanticName → ElementId so the dispatcher can
  // resolve LLM-suggested "alternativeActions" copy into concrete element IDs
  // the SDK can highlight as related.
  const allSemantics = (await prisma.uISemantic.findMany({
    where: { orgId },
    select: { elementId: true, semanticName: true },
    take: 1000,
  })) as Array<{ elementId: string; semanticName: string }>
  const semanticNameIndex = new Map<string, string>()
  for (const s of allSemantics) {
    semanticNameIndex.set(s.semanticName.toLowerCase().trim(), s.elementId)
  }

  // Pull bandit feedback signal - the existing impressions/successes columns
  // on Intervention are the population-level stats per (type, element, variant)
  // since rowId is now population-keyed. Scope to elements in this batch for
  // perf - bandit only cares about the variants in play right now.
  const variantStats = new Map<string, { impressions: number; successes: number }>()
  if (elementIds.length > 0) {
    try {
      const rows = (await prisma.intervention.findMany({
        where: { orgId, elementId: { in: elementIds } },
        select: { id: true, impressions: true, successes: true },
      })) as Array<{ id: string; impressions: number; successes: number }>
      for (const r of rows) {
        variantStats.set(r.id, { impressions: r.impressions, successes: r.successes })
      }
    } catch {
      // Stats are optional; bandit falls back to deterministic pick.
    }
  }

  // Pull pre-computed intervention cache rows for the elements + struggle
  // types in this batch. When present, the dispatcher uses these in place of
  // the in-code template variants - LLM-tailored copy, no placeholders.
  // Only display-family renderer types are accepted from cache; invasive
  // types (DOM/BEHAVIOR/AUTO_FIX) are gated by allowlist not cache.
  const RENDERABLE_FROM_CACHE = new Set([
    'OVERLAY',
    'HIGHLIGHT',
    'TOOLTIP',
    'MODAL',
    'BANNER',
    'INLINE_HINT',
    'CONFIRM',
    'ANNOUNCE',
  ] as const)
  type RenderableType = typeof RENDERABLE_FROM_CACHE extends Set<infer T> ? T : never
  const cachedVariants = new Map<
    string,
    Array<{
      type: RenderableType
      copy: string
      title?: string | null
      helpCopy?: string | null
      confidence?: number
    }>
  >()
  if (elementIds.length > 0 && detections.length > 0) {
    const struggleTypesInBatch = Array.from(
      new Set(detections.map((d) => d.type as StruggleType)),
    )
    try {
      const cacheRows = (await prisma.interventionCache.findMany({
        where: {
          orgId,
          elementId: { in: elementIds },
          struggleType: { in: struggleTypesInBatch as never },
        },
        orderBy: { variantIndex: 'asc' },
        select: {
          elementId: true,
          struggleType: true,
          variantIndex: true,
          type: true,
          copy: true,
          title: true,
          helpCopy: true,
          confidence: true,
        },
      })) as Array<{
        elementId: string
        struggleType: string
        variantIndex: number
        type: string
        copy: string
        title: string | null
        helpCopy: string | null
        confidence: number
      }>
      for (const r of cacheRows) {
        if (!RENDERABLE_FROM_CACHE.has(r.type as RenderableType)) continue
        const key = `${r.elementId}|${r.struggleType}`
        const list = cachedVariants.get(key) ?? []
        list[r.variantIndex] = {
          type: r.type as RenderableType,
          copy: r.copy,
          title: r.title,
          helpCopy: r.helpCopy,
          confidence: r.confidence,
        }
        cachedVariants.set(key, list)
      }
      // Compact any holes (variantIndex skips) so downstream array indexing
      // stays contiguous.
      for (const [key, list] of cachedVariants) {
        cachedVariants.set(
          key,
          list.filter((x) => Boolean(x)),
        )
      }
    } catch {
      // Cache is optional; dispatcher falls back to template library.
    }
  }

  const dispatched = dispatchInterventionsWithRows(detections, {
    elementLabels: labelMap,
    elementSemantics: semanticMap,
    elementRoles,
    elementValidation,
    semanticNameIndex,
    safeMode,
    routeBySession,
    routeDenylist,
    pageTitleBySession,
    routeTitles,
    routeSemantic,
    variantStats,
    cachedVariants,
  })

  // Persist Intervention rows so the dashboard can show real data.
  // We upsert on the stable id from the dispatcher and remember which existing
  // rows are paused so we don't re-fire them on the SDK.
  const pausedIds = new Set<string>()
  for (const d of dispatched) {
    if (!d.targetElementId) continue
    try {
      const exists = await prisma.uIElement.findUnique({
        where: { id: d.targetElementId },
        select: { id: true },
      })
      if (!exists) continue

      const existing = await prisma.intervention.findUnique({
        where: { id: d.rowId },
        select: { enabled: true },
      })
      if (existing && !existing.enabled) {
        pausedIds.add(d.rowId)
        continue
      }

      await prisma.intervention.upsert({
        where: { id: d.rowId },
        create: {
          id: d.rowId,
          orgId,
          elementId: d.targetElementId,
          type: d.type as never,
          config: { type: d.type, copy: d.copy } as never,
          variantGroup: d.variantGroup,
          enabled: true,
        },
        update: {
          // No-op for now; counts are managed via the outcome handler.
        },
      })
    } catch {
      // Skip persistence failures - dispatch still works.
    }
  }

  // Strip variant fields and skip paused interventions before sending to the SDK.
  const interventions = dispatched
    .filter((d) => !pausedIds.has(d.rowId))
    .map(({ rowId: _rowId, variantGroup: _vg, variantIndex: _vi, ...rest }) => rest)

  const response: EventBatchResponse = {
    accepted,
    duplicates,
    rejected: [],
    interventions,
  }

  // Best-effort usage metering - never blocks the response.
  void bumpUsage(orgId, {
    events: parsed.data.events.length,
    interventionsShown: interventions.length,
  })
  // Idempotent MAU dedup. Each unique (orgId, userIdHash, monthStart) tuple
  // gets inserted once; subsequent batches with the same hash no-op via the
  // unique index + skipDuplicates.
  const userHashes = Array.from(
    new Set(
      parsed.data.events
        .map((e) => e.userIdHash)
        .filter((h): h is string => Boolean(h)),
    ),
  )
  if (userHashes.length > 0) void trackActiveUsers(orgId, userHashes)

  return NextResponse.json(response, { status: 200, headers: corsHeaders() })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  })
}

function corsHeaders(): Record<string, string> {
  // Customers' SDKs run on their own origins. We accept any origin for the
  // ingest endpoint; per-org ingest keys (bearer) provide auth on top.
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Org-Id, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}
