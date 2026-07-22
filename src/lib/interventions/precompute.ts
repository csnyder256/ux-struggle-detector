/**
 * Pre-computed intervention worker (Phase 7 of plan).
 *
 * For each (UIElement with semantics, priority struggleType), generate K
 * tailored intervention variants via the DEEP LLM and persist as
 * InterventionCache rows. Runtime dispatch then SELECTS from cache instead
 * of falling back to the generic in-code template library - sub-second
 * latency without per-request LLM calls.
 *
 * Trigger: dashboard button. Eventually: cron + on-enrichment hook.
 *
 * Idempotent: identical (elementId, struggleType) input + same context hash
 * skips. Re-running with changed semantics regenerates.
 */

import { prisma } from '@/lib/db'
import { ProviderRegistry } from '@/lib/providers/registry'
import { hashSemanticContext, type ElementId } from '@/lib/types/ui-map'
import { bumpUsage } from '@/lib/usage/track'
import type { StruggleType } from '@/lib/types/events'
import type { InterventionType } from '@prisma/client'

export interface PrecomputeResult {
  ok: boolean
  generated: number
  skippedCached: number
  skippedNoSemantic: number
  errors: number
  errorMessages: string[]
  totalCandidates: number
}

// Top struggle types to pre-compute - covers ~80% of dispatched interventions
// based on the bandit metrics from the seed dataset. Tuned conservatively to
// keep LLM cost predictable; can extend later.
const PRIORITY_STRUGGLE_TYPES: StruggleType[] = [
  'RAGE_CLICK',
  'DEAD_CLICK',
  'INVALID_CLICK',
  'THRASH',
  'VALIDATION_LOOP',
  'REQUIRED_MISSED',
  'FORMAT_ERROR',
  'LOOP',
  'SILENT_FAIL',
  'BACK_THRASH',
  'HOVER_HUNT',
  'LONG_DWELL',
  'JS_ERROR',
  'LOGIN_FAILURE',
]

const VARIANTS_PER_PAIR = 2
const ELEMENTS_PER_RUN = 16

const SYSTEM_PROMPT = `You are a UX recovery copywriter. For each (element, struggleType) pair given, produce ${VARIANTS_PER_PAIR} short, distinct intervention variants tailored to that element's semantic role and the failure pattern the user is in.

Each variant must include:
  - type: one of OVERLAY, HIGHLIGHT, TOOLTIP, MODAL, BANNER, INLINE_HINT, CONFIRM, ANNOUNCE. Pick what fits the struggle severity (BANNER for global page issues, TOOLTIP/HIGHLIGHT for element-local, MODAL for blocking confirmations).
  - copy: the primary message shown to the user (one sentence, plain English, second-person, no jargon, no marketing voice).
  - title (optional): short headline if the renderer supports one (MODAL/BANNER).
  - helpCopy (optional): a follow-up hint if the user remains stuck.
  - confidence: 0.5–0.95, your confidence this fits.

Constraints:
  - DO NOT use {label} or other placeholders. Resolve the element identity inline (use the element's semanticName).
  - The two variants must use DIFFERENT angles (e.g., one explains what's blocked + why, one points to an alternative).
  - For RAGE_CLICK / DEAD_CLICK / LONG_DWELL on a destructive (high riskLevel) element, use CONFIRM with text like "About to permanently delete X - sure?".
  - For VALIDATION_LOOP / REQUIRED_MISSED / FORMAT_ERROR on a form input, reference the validation rules concretely.
  - When routePurpose / journeyStage is provided, lean on it: 'transact' / 'confirm' stages get more conservative, more confirmatory copy; 'discovery' / 'configure' stages get more exploratory help.

Output ONLY a JSON object matching the schema.`

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    pairs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          elementId: { type: 'string' },
          struggleType: { type: 'string' },
          variants: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: [
                    'OVERLAY',
                    'HIGHLIGHT',
                    'TOOLTIP',
                    'MODAL',
                    'BANNER',
                    'INLINE_HINT',
                    'CONFIRM',
                    'ANNOUNCE',
                  ],
                },
                copy: { type: 'string' },
                title: { type: 'string' },
                helpCopy: { type: 'string' },
                confidence: { type: 'number' },
              },
              required: ['type', 'copy', 'confidence'],
            },
          },
        },
        required: ['elementId', 'struggleType', 'variants'],
      },
    },
  },
  required: ['pairs'],
}

interface PairInput {
  elementId: string
  struggleType: StruggleType
  semanticName: string
  intent: string
  expectedOutcome: string
  failureModes: string[]
  riskLevel?: string
  helpCopy?: string
  alternativeActions?: string[]
  labelRaw?: string | null
  semanticRole?: string | null
  validation?: Record<string, unknown>
  routePath?: string
  routeTitle?: string | null
  // Pass-2 route semantic (purpose + stage) gives the LLM a much sharper
  // sense of where in the user's task this struggle lives. E.g. on a
  // 'transact' page, the right intervention is more conservative.
  routePurpose?: string
  journeyStage?: string
  successCriteria?: string | null
}

interface VariantOutput {
  type: InterventionType
  copy: string
  title?: string
  helpCopy?: string
  confidence: number
}

interface PairOutput {
  elementId: string
  struggleType: string
  variants: VariantOutput[]
}

interface BatchOutput {
  pairs: PairOutput[]
}

const VALID_RENDERER_TYPES = new Set<InterventionType>([
  'OVERLAY',
  'HIGHLIGHT',
  'TOOLTIP',
  'MODAL',
  'BANNER',
  'INLINE_HINT',
  'CONFIRM',
  'ANNOUNCE',
])

export async function precomputeForOrg(orgId: string): Promise<PrecomputeResult> {
  const result: PrecomputeResult = {
    ok: true,
    generated: 0,
    skippedCached: 0,
    skippedNoSemantic: 0,
    errors: 0,
    errorMessages: [],
    totalCandidates: 0,
  }

  let provider
  try {
    provider = await ProviderRegistry.get(orgId, 'DEEP')
  } catch (err) {
    result.ok = false
    result.errorMessages.push(
      err instanceof Error ? err.message : 'No DEEP provider key configured.',
    )
    return result
  }

  // Pull elements with at least one UISemantic - these are the ones with
  // enough data for an LLM to produce decent tailored copy. Cap per-run.
  const elements = (await prisma.uIElement.findMany({
    where: {
      orgId,
      semantics: { some: {} },
    },
    select: {
      id: true,
      labelRaw: true,
      routeTarget: true,
      componentName: true,
      elementType: true,
      semanticRole: true,
      extraction: true,
      semantics: {
        orderBy: { enrichedAt: 'desc' },
        take: 1,
        select: {
          semanticName: true,
          intent: true,
          expectedOutcome: true,
          failureModes: true,
          extraction: true,
        },
      },
    },
    take: ELEMENTS_PER_RUN,
  })) as Array<{
    id: string
    labelRaw: string | null
    routeTarget: string | null
    componentName: string | null
    elementType: string
    semanticRole: string | null
    extraction: Record<string, unknown> | null
    semantics: Array<{
      semanticName: string
      intent: string
      expectedOutcome: string
      failureModes: unknown
      extraction: Record<string, unknown> | null
    }>
  }>

  const routePaths = Array.from(
    new Set(elements.map((e) => e.routeTarget).filter((p): p is string => Boolean(p))),
  )
  const routeMeta = routePaths.length
    ? ((await prisma.uIRoute.findMany({
        where: { orgId, path: { in: routePaths } },
        select: { path: true, title: true, extraction: true } as never,
      })) as Array<{
        path: string
        title: string | null
        extraction: Record<string, unknown> | null
      }>)
    : []
  const routeTitleByPath = new Map(routeMeta.map((r) => [r.path, r.title]))
  // Pass-2 route semantic (purpose + journeyStage) is the highest-signal piece
  // we can hand the LLM about WHERE this struggle is happening in the user's
  // overall task. Resolves into `routePurpose` and `journeyStage` in the input.
  const routeSemanticByPath = new Map<
    string,
    { purpose: string; journeyStage: string; successCriteria?: string | null }
  >()
  for (const r of routeMeta) {
    const ext = (r.extraction ?? {}) as {
      routeSemantic?: {
        purpose?: string
        journeyStage?: string
        successCriteria?: string | null
      }
    }
    const rs = ext.routeSemantic
    if (rs?.purpose && rs.journeyStage) {
      routeSemanticByPath.set(r.path, {
        purpose: rs.purpose,
        journeyStage: rs.journeyStage,
        successCriteria: rs.successCriteria ?? null,
      })
    }
  }

  const platform = await prisma.platformConfig.findUnique({
    where: { orgId },
    select: { platformDescription: true },
  })

  // Build pair list. Skip those already cached with the same context hash.
  const pairsToGenerate: PairInput[] = []
  for (const el of elements) {
    if (!el.semantics.length) {
      result.skippedNoSemantic++
      continue
    }
    const sem = el.semantics[0]!
    const richSem = (sem.extraction ?? {}) as {
      helpCopy?: string
      alternativeActions?: string[]
      riskLevel?: string
    }
    const validation = ((el.extraction ?? {}) as { validation?: Record<string, unknown> })
      .validation
    const contextHash = await hashSemanticContext({
      platformDescription: platform?.platformDescription ?? '',
      route: el.routeTarget ?? '',
      parentComponent: el.componentName,
      siblings: [],
      selfDescriptor: `${el.elementType}:${el.labelRaw ?? ''}:${sem.semanticName}`,
    })

    for (const struggleType of PRIORITY_STRUGGLE_TYPES) {
      result.totalCandidates++
      const existing = await prisma.interventionCache.findFirst({
        where: { elementId: el.id, struggleType: struggleType as never },
        select: { contextHash: true },
      })
      if (existing && existing.contextHash === contextHash) {
        result.skippedCached++
        continue
      }
      const rsem = el.routeTarget ? routeSemanticByPath.get(el.routeTarget) : undefined
      pairsToGenerate.push({
        elementId: el.id,
        struggleType,
        semanticName: sem.semanticName,
        intent: sem.intent,
        expectedOutcome: sem.expectedOutcome,
        failureModes: Array.isArray(sem.failureModes) ? (sem.failureModes as string[]) : [],
        helpCopy: richSem.helpCopy,
        alternativeActions: richSem.alternativeActions,
        riskLevel: richSem.riskLevel,
        labelRaw: el.labelRaw,
        semanticRole: el.semanticRole,
        validation,
        routePath: el.routeTarget ?? undefined,
        routeTitle: el.routeTarget ? routeTitleByPath.get(el.routeTarget) ?? null : null,
        routePurpose: rsem?.purpose,
        journeyStage: rsem?.journeyStage,
        successCriteria: rsem?.successCriteria ?? null,
      })
    }
  }

  if (pairsToGenerate.length === 0) {
    return result
  }

  // Batch the LLM calls - 4 pairs per call to keep latency low and tokens
  // bounded. The model returns variants for each pair in the batch.
  const BATCH_SIZE = 4
  const batches: PairInput[][] = []
  for (let i = 0; i < pairsToGenerate.length; i += BATCH_SIZE) {
    batches.push(pairsToGenerate.slice(i, i + BATCH_SIZE))
  }

  for (const batch of batches) {
    try {
      const response = await provider.deep({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: JSON.stringify({ pairs: batch }),
        jsonSchema: OUTPUT_SCHEMA,
        maxTokens: 4096,
      })
      const tokens = (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0)
      if (tokens > 0) void bumpUsage(orgId, { deepTokens: tokens })

      let parsed: BatchOutput | null = null
      if (response.parsed && typeof response.parsed === 'object') {
        parsed = response.parsed as BatchOutput
      } else if (response.content) {
        try {
          parsed = JSON.parse(response.content) as BatchOutput
        } catch {
          parsed = null
        }
      }

      if (!parsed || !Array.isArray(parsed.pairs)) {
        result.errors++
        result.errorMessages.push('LLM returned malformed batch.')
        continue
      }

      for (const pair of parsed.pairs) {
        const input = batch.find(
          (p) => p.elementId === pair.elementId && p.struggleType === pair.struggleType,
        )
        if (!input) continue

        const contextHash = await hashSemanticContext({
          platformDescription: platform?.platformDescription ?? '',
          route: input.routePath ?? '',
          parentComponent: null,
          siblings: [],
          selfDescriptor: `${input.elementId}:${input.semanticName}`,
        })

        const variants = (Array.isArray(pair.variants) ? pair.variants : []).slice(
          0,
          VARIANTS_PER_PAIR,
        )

        // Wipe stale variants for this (element, struggle) before writing - so
        // the cache always reflects the latest LLM output for the pair.
        try {
          await prisma.interventionCache.deleteMany({
            where: {
              elementId: input.elementId,
              struggleType: input.struggleType as never,
            },
          })
        } catch {
          // Continue - the upsert below handles dups via the unique index.
        }

        for (let i = 0; i < variants.length; i++) {
          const v = variants[i]!
          if (!VALID_RENDERER_TYPES.has(v.type)) continue
          if (!v.copy || v.copy.trim().length === 0) continue
          try {
            await prisma.interventionCache.create({
              data: {
                orgId,
                elementId: input.elementId as ElementId as string,
                struggleType: input.struggleType as never,
                variantIndex: i,
                type: v.type,
                copy: v.copy.trim(),
                title: v.title?.trim() || null,
                helpCopy: v.helpCopy?.trim() || null,
                relatedElementIds: [] as never,
                confidence: typeof v.confidence === 'number' ? v.confidence : 0.7,
                contextHash,
              },
            })
            result.generated++
          } catch (err) {
            result.errors++
            result.errorMessages.push(
              err instanceof Error
                ? `${input.elementId}/${input.struggleType}/v${i}: ${err.message}`
                : 'persist failure',
            )
          }
        }
      }
    } catch (err) {
      result.errors++
      result.errorMessages.push(err instanceof Error ? err.message : 'LLM call failed.')
    }
  }

  result.ok = result.errors === 0 || result.generated > 0
  return result
}
