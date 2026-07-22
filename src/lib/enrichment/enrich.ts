/**
 * Semantic LLM enrichment worker.
 *
 * Walks UIElements that don't yet have a UISemantic row, batches them, calls
 * the org's DEEP-tier ModelProvider with structured JSON output, and persists
 * the semantic name + intent + expected outcome + failure modes.
 *
 * The cache key per the plan is `(elementId, contextHash)` where contextHash
 * is a digest of (platformDescription, route, parent component, siblings,
 * self-descriptor). When any of those change, the same element gets a new
 * UISemantic row on the next pass.
 *
 * Runs synchronously when triggered from the dashboard. A queued worker that
 * batch-enriches on a schedule is a later phase.
 */

import { prisma } from '@/lib/db'
import { ProviderRegistry } from '@/lib/providers/registry'
import { hashSemanticContext } from '@/lib/types/ui-map'
import { bumpUsage } from '@/lib/usage/track'

export interface EnrichmentResult {
  ok: boolean
  enriched: number
  skipped: number
  errors: number
  errorMessages: string[]
  totalElements: number
  remaining: number
}

const BATCH_SIZE = 8
const MAX_BATCHES_PER_RUN = 4 // 32 elements per dashboard click

const SYSTEM_PROMPT = `You are a UX analyst studying a specific software platform. For each interactive UI element provided, return a concise semantic understanding of:

  - semanticName: short verb-noun phrase the user thinks of this as (e.g. "Complete purchase", "Reset password", "Add team member"). Prefer precise verb-noun pairs over generic words like "Click" or "Submit".
  - intent: in one short sentence, what the user is trying to accomplish.
  - expectedOutcome: what should happen after a successful interaction.
  - failureModes: short phrases describing things that commonly go wrong here.
  - helpCopy: one-sentence assist copy the SDK can show this user if they get stuck on this element. Plain English. No marketing voice. Speak directly to the user.
  - alternativeActions: other elements (use the semanticName naming style) the user might be looking for if this one isn't what they want.
  - dependencies: other fields/elements that must be filled / completed first.
  - riskLevel: 'low' | 'medium' | 'high'. High = destructive / irreversible (delete account, complete payment, archive, etc).

The input includes:
  - platformName + platformDescription: the broader product context.
  - elements: array of UI elements. Each has filePath, elementType, labelRaw, handlerFunction, routeTarget, componentName, extraction (validation rules, semanticRole, formContext, placeholder, helpText, etc), and page (the route's title, description, sections, authRequired).

USE the page context - the route's title and section headings are strong hints about what each element does. USE the validation rules - required + minLength etc tell you the format constraints. USE the formContext - fields in the same form are often related dependencies. USE the semanticRole hint when present - it's a coarse signal you should refine.

Output ONLY the JSON object matching the schema. No prose, no markdown.`

interface BatchElementInput {
  id: string
  filePath: string
  componentName: string | null
  elementType: string
  labelRaw: string | null
  handlerFunction: string | null
  routeTarget: string | null
  /** Rich extraction: validation, semanticRole, formContext, placeholder, helpText, etc. */
  extraction?: Record<string, unknown>
  /** Page-level context for the route this element appears on. */
  page?: {
    path: string
    title?: string | null
    description?: string | null
    sections?: string[]
    authRequired?: boolean
  }
}

interface BatchInput {
  platformName: string
  platformDescription: string
  elements: BatchElementInput[]
}

interface ElementSemantic {
  id: string
  semanticName: string
  intent: string
  expectedOutcome: string
  failureModes: string[]
  /** New fields the model is asked to fill in for richer dispatch. */
  helpCopy?: string
  alternativeActions?: string[]
  dependencies?: string[]
  riskLevel?: 'low' | 'medium' | 'high'
}

interface BatchOutput {
  elements: ElementSemantic[]
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    elements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The same id you were given for this element.' },
          semanticName: {
            type: 'string',
            description: 'Short verb-noun phrase, e.g. "Complete purchase" or "Confirm subscription".',
          },
          intent: {
            type: 'string',
            description: 'What the user is trying to accomplish in 1 short sentence.',
          },
          expectedOutcome: {
            type: 'string',
            description: 'What should happen after a successful interaction.',
          },
          failureModes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Likely things that go wrong (short phrases).',
          },
          helpCopy: {
            type: 'string',
            description:
              'One-sentence assist copy the SDK will show if a user struggles here. Plain English, no jargon.',
          },
          alternativeActions: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Other elements the user might be looking for if they are stuck on this one (semantic names).',
          },
          dependencies: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Other fields/elements that must be filled / completed before this one is usable.',
          },
          riskLevel: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description:
              'How destructive / irreversible is this action? Used to gate AUTO_FIX interventions.',
          },
        },
        required: ['id', 'semanticName', 'intent', 'expectedOutcome', 'failureModes'],
      },
    },
  },
  required: ['elements'],
}

export async function enrichOrg(orgId: string): Promise<EnrichmentResult> {
  const result: EnrichmentResult = {
    ok: true,
    enriched: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
    totalElements: 0,
    remaining: 0,
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

  const total = await prisma.uIElement.count({ where: { orgId } })
  result.totalElements = total

  const elements = (await prisma.uIElement.findMany({
    where: {
      orgId,
      semantics: { none: {} },
    },
    select: {
      id: true,
      filePath: true,
      elementType: true,
      labelRaw: true,
      handlerFunction: true,
      routeTarget: true,
      componentName: true,
      extraction: true,
    } as never,
    take: BATCH_SIZE * MAX_BATCHES_PER_RUN,
  })) as Array<{
    id: string
    filePath: string
    elementType: string
    labelRaw: string | null
    handlerFunction: string | null
    routeTarget: string | null
    componentName: string | null
    extraction: Record<string, unknown> | null
  }>
  result.remaining = elements.length

  if (elements.length === 0) {
    return result
  }

  // Pre-fetch route metadata for any routes the elements live on, so the LLM
  // can reason about page context (page title + auth requirements + sections).
  const routePaths = Array.from(
    new Set(elements.map((e) => e.routeTarget).filter((p): p is string => Boolean(p))),
  )
  const routeMeta = routePaths.length
    ? ((await prisma.uIRoute.findMany({
        where: { orgId, path: { in: routePaths } },
        select: {
          path: true,
          title: true,
          description: true,
          authRequired: true,
          extraction: true,
        } as never,
      })) as Array<{
        path: string
        title: string | null
        description: string | null
        authRequired: boolean
        extraction: Record<string, unknown>
      }>)
    : []
  const routeMap = new Map<string, (typeof routeMeta)[number]>()
  for (const r of routeMeta) routeMap.set(r.path, r)

  const batches: typeof elements[] = []
  for (let i = 0; i < elements.length; i += BATCH_SIZE) {
    batches.push(elements.slice(i, i + BATCH_SIZE))
  }

  for (const batch of batches.slice(0, MAX_BATCHES_PER_RUN)) {
    try {
      const input: BatchInput = {
        platformName: platform.platformName,
        platformDescription: platform.platformDescription,
        elements: batch.map((e) => {
          const route = e.routeTarget ? routeMap.get(e.routeTarget) : undefined
          const sections = (route?.extraction as { sections?: string[] } | undefined)?.sections
          return {
            id: e.id,
            filePath: e.filePath,
            elementType: e.elementType,
            labelRaw: e.labelRaw,
            handlerFunction: e.handlerFunction,
            routeTarget: e.routeTarget,
            componentName: e.componentName,
            extraction: (e.extraction ?? {}) as Record<string, unknown>,
            page: route
              ? {
                  path: route.path,
                  title: route.title,
                  description: route.description,
                  sections,
                  authRequired: route.authRequired,
                }
              : undefined,
          }
        }),
      }

      const response = await provider.deep({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: JSON.stringify(input),
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

      if (!parsed || !Array.isArray(parsed.elements)) {
        result.errors++
        result.errorMessages.push('LLM returned malformed batch output.')
        continue
      }

      for (const sem of parsed.elements) {
        const el = batch.find((e) => e.id === sem.id)
        if (!el) {
          result.skipped++
          continue
        }
        try {
          const contextHash = await hashSemanticContext({
            platformDescription: platform.platformDescription,
            route: el.routeTarget ?? '',
            parentComponent: el.componentName,
            siblings: [],
            selfDescriptor: `${el.elementType}:${el.labelRaw ?? ''}`,
          })

          const richFields = {
            helpCopy: sem.helpCopy ?? null,
            alternativeActions: sem.alternativeActions ?? [],
            dependencies: sem.dependencies ?? [],
            riskLevel: sem.riskLevel ?? 'low',
          }
          await prisma.uISemantic.upsert({
            where: {
              elementId_contextHash: { elementId: el.id, contextHash },
            },
            create: {
              orgId,
              elementId: el.id,
              contextHash,
              semanticName: sem.semanticName,
              intent: sem.intent,
              expectedOutcome: sem.expectedOutcome,
              failureModes: sem.failureModes ?? [],
              extraction: richFields as never,
            } as never,
            update: {
              semanticName: sem.semanticName,
              intent: sem.intent,
              expectedOutcome: sem.expectedOutcome,
              failureModes: sem.failureModes ?? [],
              extraction: richFields as never,
            } as never,
          })
          result.enriched++
        } catch {
          result.errors++
        }
      }
    } catch (err) {
      result.errors++
      result.errorMessages.push(
        err instanceof Error ? err.message : 'LLM call failed for batch.',
      )
    }
  }

  result.ok = result.errors < batches.length
  return result
}
