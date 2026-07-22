/**
 * Route-level enrichment (Phase 2 - Pass 2 of plan).
 *
 * Pass 1 (in enrich.ts) is element-level. This is Pass 2: given a route plus
 * the now-enriched semantic info for elements on it, synthesize a higher-level
 * understanding of the route itself - what it's for, where it sits in the user
 * journey, which elements are critical, what success looks like.
 *
 * The output writes to UIRoute.extraction.routeSemantic. The dispatcher
 * (and the pre-compute worker) read this to make page-aware decisions.
 *
 * Pass 2 is idempotent per (orgId, routePath, contextHash). Re-running with
 * unchanged element semantics no-ops.
 */

import { prisma } from '@/lib/db'
import { ProviderRegistry } from '@/lib/providers/registry'
import { hashSemanticContext } from '@/lib/types/ui-map'
import { bumpUsage } from '@/lib/usage/track'

export interface RouteEnrichmentResult {
  ok: boolean
  enriched: number
  skippedNoElements: number
  skippedCached: number
  errors: number
  errorMessages: string[]
  totalRoutes: number
}

const ROUTES_PER_RUN = 8

const SYSTEM_PROMPT = `You are a UX analyst studying a software platform's information architecture. For each route given, look at the elements on the page and synthesize a route-level understanding.

For each route output:
  - purpose: 1 sentence - what is this page FOR in the user's task flow.
  - journeyStage: one of 'entry' | 'discovery' | 'configure' | 'transact' | 'confirm' | 'post-action' | 'admin'.
  - keyElementIds: a short list of the elementIds (from the input) that represent the primary actions on this page. Pick AT MOST 3.
  - entryConditions: short list of preconditions a user typically needs (e.g. "logged in", "has selected a project", "has an unpaid invoice"). Empty list is fine if the page is open access.
  - successCriteria: 1 sentence - what does a successful visit look like? (e.g. "User submits the form, sees confirmation, lands on /dashboard").
  - exitElementIds: elementIds the user is most likely to click LAST when leaving the page successfully.

Output ONLY a JSON object matching the schema.`

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    routes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          purpose: { type: 'string' },
          journeyStage: {
            type: 'string',
            enum: ['entry', 'discovery', 'configure', 'transact', 'confirm', 'post-action', 'admin'],
          },
          keyElementIds: { type: 'array', items: { type: 'string' } },
          entryConditions: { type: 'array', items: { type: 'string' } },
          successCriteria: { type: 'string' },
          exitElementIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['path', 'purpose', 'journeyStage'],
      },
    },
  },
  required: ['routes'],
}

interface RouteInput {
  path: string
  title: string | null
  description: string | null
  authRequired: boolean
  sections: string[]
  elements: Array<{
    id: string
    elementType: string
    label: string | null
    semanticName: string | null
    intent: string | null
    expectedOutcome: string | null
    riskLevel: string | null
  }>
}

interface RouteOutput {
  path: string
  purpose: string
  journeyStage:
    | 'entry'
    | 'discovery'
    | 'configure'
    | 'transact'
    | 'confirm'
    | 'post-action'
    | 'admin'
  keyElementIds?: string[]
  entryConditions?: string[]
  successCriteria?: string
  exitElementIds?: string[]
}

interface BatchOutput {
  routes: RouteOutput[]
}

export async function enrichRoutesForOrg(orgId: string): Promise<RouteEnrichmentResult> {
  const result: RouteEnrichmentResult = {
    ok: true,
    enriched: 0,
    skippedNoElements: 0,
    skippedCached: 0,
    errors: 0,
    errorMessages: [],
    totalRoutes: 0,
  }

  const platform = await prisma.platformConfig.findUnique({
    where: { orgId },
    select: { platformName: true, platformDescription: true },
  })
  if (!platform) {
    result.ok = false
    result.errorMessages.push('No platform config - finish onboarding first.')
    return result
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

  const routes = (await prisma.uIRoute.findMany({
    where: { orgId },
    select: {
      id: true,
      path: true,
      title: true,
      description: true,
      authRequired: true,
      extraction: true,
    } as never,
    take: ROUTES_PER_RUN,
  })) as Array<{
    id: string
    path: string
    title: string | null
    description: string | null
    authRequired: boolean
    extraction: Record<string, unknown> | null
  }>
  result.totalRoutes = routes.length

  if (routes.length === 0) {
    return result
  }

  // Pull enriched elements for these routes.
  const routePaths = routes.map((r) => r.path)
  const elements = (await prisma.uIElement.findMany({
    where: { orgId, routeTarget: { in: routePaths } },
    select: {
      id: true,
      routeTarget: true,
      elementType: true,
      labelRaw: true,
      semantics: {
        orderBy: { enrichedAt: 'desc' },
        take: 1,
        select: {
          semanticName: true,
          intent: true,
          expectedOutcome: true,
          extraction: true,
        },
      },
    },
  })) as Array<{
    id: string
    routeTarget: string | null
    elementType: string
    labelRaw: string | null
    semantics: Array<{
      semanticName: string
      intent: string
      expectedOutcome: string
      extraction: Record<string, unknown> | null
    }>
  }>

  const elementsByRoute = new Map<string, typeof elements>()
  for (const el of elements) {
    if (!el.routeTarget) continue
    const list = elementsByRoute.get(el.routeTarget) ?? []
    list.push(el)
    elementsByRoute.set(el.routeTarget, list)
  }

  // Prepare batch - skip routes with no enriched elements (nothing to feed
  // the LLM) AND skip routes where the cached enrichment is still fresh
  // (same context hash).
  const batchInput: Array<{ routeId: string; payload: RouteInput; contextHash: string }> = []
  for (const r of routes) {
    const els = elementsByRoute.get(r.path) ?? []
    const enrichedEls = els.filter((e) => e.semantics.length > 0)
    if (enrichedEls.length === 0) {
      result.skippedNoElements++
      continue
    }
    const ext = (r.extraction ?? {}) as {
      sections?: string[]
      routeSemantic?: { contextHash?: string }
    }
    const sections = Array.isArray(ext.sections) ? ext.sections : []
    const elementSig = enrichedEls
      .map((e) => `${e.id}:${e.semantics[0]?.semanticName ?? ''}`)
      .sort()
      .join('|')
    const contextHash = await hashSemanticContext({
      platformDescription: platform.platformDescription,
      route: r.path,
      parentComponent: null,
      siblings: [],
      selfDescriptor: elementSig,
    })
    if (ext.routeSemantic?.contextHash === contextHash) {
      result.skippedCached++
      continue
    }
    batchInput.push({
      routeId: r.id,
      contextHash,
      payload: {
        path: r.path,
        title: r.title,
        description: r.description,
        authRequired: r.authRequired,
        sections,
        elements: enrichedEls.map((e) => {
          const sem = e.semantics[0]!
          const richSem = (sem.extraction ?? {}) as { riskLevel?: string }
          return {
            id: e.id,
            elementType: e.elementType,
            label: e.labelRaw,
            semanticName: sem.semanticName ?? null,
            intent: sem.intent ?? null,
            expectedOutcome: sem.expectedOutcome ?? null,
            riskLevel: richSem.riskLevel ?? null,
          }
        }),
      },
    })
  }

  if (batchInput.length === 0) {
    return result
  }

  // One LLM call for the whole run - routes don't share much, but the LLM is
  // good at cross-route reasoning (this checkout is the next stop after that
  // cart page). Still keep an upper limit to control tokens.
  try {
    const response = await provider.deep({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: JSON.stringify({
        platformName: platform.platformName,
        platformDescription: platform.platformDescription,
        routes: batchInput.map((b) => b.payload),
      }),
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
    if (!parsed || !Array.isArray(parsed.routes)) {
      result.errors++
      result.errorMessages.push('LLM returned malformed route batch.')
      return result
    }

    for (const out of parsed.routes) {
      const input = batchInput.find((b) => b.payload.path === out.path)
      if (!input) continue

      const route = routes.find((r) => r.path === out.path)
      if (!route) continue

      const existingExt = (route.extraction ?? {}) as Record<string, unknown>
      const merged = {
        ...existingExt,
        routeSemantic: {
          purpose: out.purpose,
          journeyStage: out.journeyStage,
          keyElementIds: Array.isArray(out.keyElementIds) ? out.keyElementIds.slice(0, 3) : [],
          entryConditions: Array.isArray(out.entryConditions) ? out.entryConditions : [],
          successCriteria: out.successCriteria ?? null,
          exitElementIds: Array.isArray(out.exitElementIds) ? out.exitElementIds.slice(0, 3) : [],
          contextHash: input.contextHash,
          enrichedAt: new Date().toISOString(),
        },
      }

      try {
        await prisma.uIRoute.update({
          where: { id: route.id },
          data: { extraction: merged as never },
        })
        result.enriched++
      } catch {
        result.errors++
      }
    }
  } catch (err) {
    result.errors++
    result.errorMessages.push(err instanceof Error ? err.message : 'LLM call failed.')
  }

  result.ok = result.errors === 0 || result.enriched > 0
  return result
}
