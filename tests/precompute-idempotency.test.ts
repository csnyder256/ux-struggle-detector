/**
 * Intervention pre-compute: the worker is documented as idempotent - "identical
 * (elementId, struggleType) input + same context hash skips. Re-running with
 * changed semantics regenerates." The cron endpoint relies on that: it runs the
 * worker for every eligible org ONCE AN HOUR, and the worker's own docstring
 * says the 16-elements-per-run cap is what keeps cost predictable.
 *
 * That contract only holds if the hash written onto the cached row is the SAME
 * digest the next run compares against. It was not: the selection step hashed
 * `elementType:labelRaw:semanticName` (plus the parent component), while the
 * write step re-derived a hash from `elementId:semanticName` with no parent.
 * Two different digests over two different descriptors can never be equal, so
 * `existing.contextHash === contextHash` was never true, `skippedCached` stayed
 * 0, and every hourly run deleted and regenerated every pair - re-billing the
 * LLM for elements whose semantics had not changed at all.
 *
 * These tests call the REAL `precomputeForOrg` with only Prisma and the
 * provider registry mocked - no database, no LLM, no re-implementation of the
 * hashing. The cache mock stores what `create()` was handed, exactly as the DB
 * would, so the assertion measures the real read-vs-write key agreement.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

/** One stored InterventionCache row, keyed by the unique (elementId, struggleType). */
interface CacheRow {
  elementId: string
  struggleType: string
  contextHash: string
}

const cacheRows = new Map<string, CacheRow>()
let deepCalls = 0
let platformDescription = 'A small online store.'

/** The single enriched element every run selects. */
const ELEMENT = {
  id: 'el_1',
  labelRaw: 'Place order',
  routeTarget: '/checkout',
  componentName: 'CheckoutForm',
  elementType: 'BUTTON',
  semanticRole: 'PRIMARY',
  extraction: {},
  semantics: [
    {
      semanticName: 'Complete purchase',
      intent: 'Pay for the items in the cart.',
      expectedOutcome: 'An order confirmation appears.',
      failureModes: ['Payment declined'],
      extraction: { riskLevel: 'high' },
    },
  ],
}

function cacheKey(elementId: string, struggleType: string): string {
  return `${elementId}|${struggleType}`
}

vi.mock('@/lib/db', () => ({
  prisma: {
    platformConfig: {
      findUnique: async () => ({ platformDescription }),
    },
    uIElement: {
      findMany: async () => [ELEMENT],
    },
    uIRoute: {
      findMany: async () => [{ path: '/checkout', title: 'Checkout', extraction: null }],
    },
    interventionCache: {
      findFirst: async (args: { where: { elementId: string; struggleType: string } }) =>
        cacheRows.get(cacheKey(args.where.elementId, args.where.struggleType)) ?? null,
      deleteMany: async (args: { where: { elementId: string; struggleType: string } }) => {
        cacheRows.delete(cacheKey(args.where.elementId, args.where.struggleType))
        return { count: 0 }
      },
      create: async (args: {
        data: { elementId: string; struggleType: string; contextHash: string }
      }) => {
        const { elementId, struggleType, contextHash } = args.data
        cacheRows.set(cacheKey(elementId, struggleType), { elementId, struggleType, contextHash })
        return args.data
      },
    },
    // `bumpUsage` writes here; a no-op keeps the worker off the real client.
    usageMonth: { upsert: async () => ({}) },
  },
}))

vi.mock('@/lib/providers/registry', () => ({
  ProviderRegistry: {
    get: async () => ({
      deep: async (args: { userPrompt: string }) => {
        deepCalls++
        const input = JSON.parse(args.userPrompt) as {
          pairs: Array<{ elementId: string; struggleType: string; semanticName: string }>
        }
        return {
          parsed: {
            pairs: input.pairs.map((p) => ({
              elementId: p.elementId,
              struggleType: p.struggleType,
              variants: [
                { type: 'TOOLTIP', copy: `Explain ${p.semanticName}`, confidence: 0.7 },
                { type: 'HIGHLIGHT', copy: `Point at ${p.semanticName}`, confidence: 0.6 },
              ],
            })),
          },
          usage: { inputTokens: 10, outputTokens: 10 },
        }
      },
    }),
  },
}))

async function run() {
  const { precomputeForOrg } = await import('@/lib/interventions/precompute')
  return precomputeForOrg('org_1')
}

beforeEach(() => {
  cacheRows.clear()
  deepCalls = 0
  platformDescription = 'A small online store.'
})

describe('intervention pre-compute is idempotent across runs', () => {
  it('a second run with unchanged context skips every pair and calls no model', async () => {
    const first = await run()
    // 14 priority struggle types x 1 element, 2 variants each.
    expect(first.totalCandidates).toBe(14)
    expect(first.generated).toBe(28)
    expect(first.skippedCached).toBe(0)
    const callsAfterFirst = deepCalls
    expect(callsAfterFirst).toBeGreaterThan(0)

    const second = await run()
    // The whole point: nothing changed, so nothing is regenerated.
    expect(second.totalCandidates).toBe(14)
    expect(second.skippedCached).toBe(14)
    expect(second.generated).toBe(0)
    // And the LLM is not re-billed for the unchanged pairs.
    expect(deepCalls).toBe(callsAfterFirst)
  })

  it('a changed context regenerates (the skip is keyed on the context, not on run count)', async () => {
    await run()
    const callsAfterFirst = deepCalls

    platformDescription = 'A large online store with subscriptions.'
    const third = await run()

    expect(third.skippedCached).toBe(0)
    expect(third.generated).toBe(28)
    expect(deepCalls).toBeGreaterThan(callsAfterFirst)
  })

  it('the stored row carries the selection-time hash, not a re-derived one', async () => {
    await run()
    const stored = cacheRows.get(cacheKey('el_1', 'RAGE_CLICK'))
    expect(stored, 'a row was written for the pair').toBeTruthy()

    // Recompute the hash exactly as the SELECTION step does - the descriptor
    // the read-side comparison uses. The row the worker persisted must carry
    // that same digest; a write path that re-derived a different one is the
    // defect this test pins.
    const { hashSemanticContext } = await import('@/lib/types/ui-map')
    const selectionHash = await hashSemanticContext({
      platformDescription: 'A small online store.',
      route: '/checkout',
      parentComponent: 'CheckoutForm',
      siblings: [],
      selfDescriptor: 'BUTTON:Place order:Complete purchase',
    })
    expect(stored!.contextHash).toBe(selectionHash)
  })
})
