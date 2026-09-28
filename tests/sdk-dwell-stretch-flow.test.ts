/**
 * End-to-end: the SDK's real dwell timer -> the real ingest schema -> the real
 * baseline aggregation, with the real detector still adapting.
 *
 * The grouping fix is only worth anything if the SDK actually stamps one stable
 * id per quiet stretch and a new one after a resume, and if the id survives the
 * wire schema unchanged. These tests drive the real SDK against jsdom, validate
 * the emitted events through the real `RuntimeEventSchema`, and feed the
 * surviving rows into the real `computeBaselinesForOrg` (Prisma mocked).
 *
 * The invariant under test: N quiet stretches produce N baseline samples, no
 * matter how many heartbeats each stretch was reported with - while a long
 * stretch can still clear a baseline-raised detector threshold.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { bootSdk, tick, dwellEvents, moveMouse } from './helpers/sdk-dom'
import { RuntimeEventSchemaExport as RuntimeEventSchema } from '@/lib/ingest/schema'
import { detectStruggles } from '@/lib/struggle/detect'
import type { RuntimeEvent } from '@/lib/types/events'

const NOW = new Date('2026-01-15T12:00:00Z')

let storedEvents: Array<{
  sessionId: string
  ts: Date
  eventType: string
  meta: Record<string, unknown> | null
}> = []
let written: Record<string, unknown> | undefined

vi.mock('@/lib/db', () => ({
  prisma: {
    uIElement: {
      findMany: async () => [{ id: 'el_1', extraction: {} }],
      update: async (args: { data: { extraction: Record<string, unknown> } }) => {
        written = args.data.extraction
        return {}
      },
    },
    userEvent: {
      findMany: async () =>
        [...storedEvents].sort((a, b) => a.ts.getTime() - b.ts.getTime()),
    },
  },
}))

afterEach(async () => {
  const { vi: v } = await import('vitest')
  v.useRealTimers()
})

beforeEach(() => {
  storedEvents = []
  written = undefined
  // Fake timers, system time and a fresh module graph are all owned by
  // `bootSdk` (it must set them before the SDK installs its interval and
  // listeners). Repeating them here raced the SDK's setup and made the tests
  // fail intermittently on a busy box; only the mock's state is reset here.
})

/**
 * Advance the SDK's virtual clock until `pred` holds, or a generous wall-clock
 * budget is spent. It returns early the instant the condition is met, so the
 * large budget costs nothing on an idle box; it exists because under parallel
 * test load a single timer advance delivers fewer interval callbacks, and a
 * fixed iteration count turns "the machine was busy" into a false failure. The
 * test then depends on the SDK's observable behaviour, never on scheduling.
 */
async function settleUntil(
  pred: () => boolean,
  budgetMs = 300_000,
  stepMs = 1_000,
): Promise<void> {
  for (let elapsed = 0; elapsed < budgetMs; elapsed += stepMs) {
    if (pred()) return
    await tick(stepMs)
  }
}

/** Push an SDK event through the real wire schema, returning the accepted form. */
function throughIngest(e: RuntimeEvent): RuntimeEvent {
  const parsed = RuntimeEventSchema.safeParse(e)
  expect(parsed.success, JSON.stringify(parsed)).toBe(true)
  if (!parsed.success) throw new Error('rejected')
  return parsed.data as RuntimeEvent
}

describe('SDK quiet-stretch identity survives ingest into baseline grouping', () => {
  it('every report of one stretch shares an id that the ingest schema keeps', async () => {
    const run = await bootSdk('<div id="hero">Docs</div>')
    try {
      await settleUntil(() => dwellEvents(run.events).length >= 5)
      const dwell = dwellEvents(run.events)
      expect(dwell.length).toBeGreaterThan(1)

      const accepted = dwell.map(throughIngest)
      const ids = accepted.map((e) => e.meta?.stretch)
      expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
      // One quiet stretch => one id across all its heartbeats.
      expect(new Set(ids).size).toBe(1)
      // ... and the heartbeat lengths really are all distinct, which is why
      // "count distinct ms" was never a valid way to count stretches.
      expect(new Set(accepted.map((e) => e.meta?.ms)).size).toBe(accepted.length)
    } finally {
      run.stop()
    }
  })

  it('a resumed interaction mints a new stretch id', async () => {
    const run = await bootSdk('<div id="panel"><button id="cta">Open</button></div>')
    try {
      const cta = run.doc.getElementById('cta')!
      moveMouse(cta)
      await settleUntil(() => dwellEvents(run.events).length >= 3)
      const firstReport = dwellEvents(run.events)[0]
      const firstId = firstReport?.meta?.stretch
      expect(typeof firstId).toBe('string')
      // Everything before the resume belongs to the first stretch.
      expect(
        dwellEvents(run.events).every((e) => e.meta?.stretch === firstId),
      ).toBe(true)

      moveMouse(cta) // the user comes back
      await tick(1_000)
      // Wait specifically for a report that carries a DIFFERENT id, so the
      // assertion cannot be satisfied by more reports of the first stretch.
      await settleUntil(() =>
        dwellEvents(run.events).some((e) => e.meta?.stretch !== firstId),
      )

      const all = dwellEvents(run.events).map((e) => e.meta?.stretch)
      const ids = new Set(all)
      expect(ids.size).toBeGreaterThanOrEqual(2)
      // The first stretch's id is never reused by a later stretch.
      const laterIds = all.filter((id) => id !== firstId)
      expect(laterIds.length).toBeGreaterThan(0)
      expect(new Set(laterIds).has(firstId!)).toBe(false)
    } finally {
      run.stop()
    }
  })

  it('N real stretches produce N baseline samples, not N heartbeats', async () => {
    const run = await bootSdk('<div id="panel"><button id="cta">Open</button></div>')
    try {
      const cta = run.doc.getElementById('cta')!
      // Four separate quiet stretches on the same element. The last is long, so
      // it is re-reported several times - the condition that used to inflate the
      // p95 by padding the sample with heartbeats.
      for (let s = 0; s < 4; s++) {
        const targetIds = s + 1
        moveMouse(cta)
        // Wait until `targetIds` distinct stretch ids have been seen; each loop
        // corresponds to exactly one new stretch, however many ticks the loaded
        // scheduler needs to deliver it. The 4th also waits for >= 4 rows.
        const minRows = s === 3 ? 8 : targetIds
        await settleUntil(() => {
          const ids = new Set(
            dwellEvents(run.events).map((e) => e.meta?.stretch as string),
          )
          return ids.size >= targetIds && dwellEvents(run.events).length >= minRows
        })
      }

      const accepted = dwellEvents(run.events).map(throughIngest)
      const distinctStretches = new Set(accepted.map((e) => e.meta?.stretch))
      expect(distinctStretches.size).toBe(4)
      // Heartbeats outnumber stretches: the long 4th stretch alone is reported
      // more than once, which is the condition that used to inflate the p95.
      expect(accepted.length).toBeGreaterThan(distinctStretches.size)

      // Feed the surviving rows to the real aggregation for one element.
      storedEvents = accepted.map((e, i) => ({
        sessionId: 'sess_1',
        ts: new Date(NOW.getTime() - 10_000 + i * 10),
        eventType: 'DWELL',
        meta: e.meta as Record<string, unknown>,
      }))
      // Satisfy MIN_EVENTS / MIN_SESSIONS without touching the dwell inputs.
      for (let s = 0; s < 3; s++) {
        for (let i = 0; i < 10; i++) {
          storedEvents.push({
            sessionId: `filler_${s}`,
            ts: new Date(NOW.getTime() - 60_000 - i * 100),
            eventType: 'CLICK',
            meta: null,
          })
        }
      }

      // The grouping must produce one sample per stretch. Compute the expected
      // p95 from the per-stretch maxima and require the real aggregation to
      // match it exactly - a heartbeat-counting implementation would report the
      // near-max heartbeat instead and could not match.
      const perStretch = new Map<string, number>()
      for (const e of accepted) {
        const key = String(e.meta?.stretch)
        const ms = Number(e.meta?.ms ?? 0)
        perStretch.set(key, Math.max(perStretch.get(key) ?? 0, ms))
      }
      expect(perStretch.size).toBe(4)

      const { computeBaselinesForOrg } = await import('@/lib/struggle/baselines')
      const result = await computeBaselinesForOrg('org_1')
      expect(result.computed, JSON.stringify(result.errorMessages)).toBe(1)

      const baseline = (written as { baseline?: { p95DwellMs: number | null } })
        .baseline!
      const samples = [...perStretch.values()].sort((a, b) => a - b)
      const idx = Math.min(samples.length - 1, Math.floor(0.95 * samples.length))
      expect(baseline.p95DwellMs).toBe(samples[idx])

      // And the count proves the weighting: four samples, not the ~dozen rows.
      expect(accepted.length).toBeGreaterThan(perStretch.size)
    } finally {
      run.stop()
    }
  })

  it('an adapted threshold is still reachable from a long stretch that was grouped to one sample', async () => {
    const run = await bootSdk('<div id="panel"><button id="cta">Open</button></div>')
    try {
      const cta = run.doc.getElementById('cta')!
      moveMouse(cta) // the last thing touched before going quiet
      await settleUntil(() => dwellEvents(run.events).length >= 60)
      const accepted = dwellEvents(run.events).map(throughIngest)
      // One stretch, many heartbeats.
      expect(new Set(accepted.map((e) => e.meta?.stretch)).size).toBe(1)

      const elementId = accepted[0]?.elementId as string
      expect(elementId).toBeTruthy()

      // Baseline p95 = 30s => detector raises the floor to max(30s, 45s) = 45s.
      const p95DwellMs = 30_000
      const adaptedThreshold = Math.max(30_000, Math.ceil(p95DwellMs * 1.5))
      const dets = detectStruggles(accepted, {
        baselines: new Map([[elementId, { p95DwellMs, sampleSize: 30 }]]),
      }).filter((d) => d.type === 'LONG_DWELL')
      expect(dets).toHaveLength(1)
      expect(dets[0]?.summary).toMatch(/adapted threshold/)
      // The evidence that cleared it is a real stretch length, not a heartbeat.
      const longest = Math.max(...accepted.map((e) => Number(e.meta?.ms ?? 0)))
      expect(longest).toBeGreaterThanOrEqual(adaptedThreshold - 1_000)

      // And that same evidence collapses to ONE sample in the baseline, so the
      // 70s stretch cannot out-vote a pile of 10s stretches.
      const grouped = new Map<string, number>()
      for (const e of accepted) {
        const key = String(e.meta?.stretch)
        grouped.set(key, Math.max(grouped.get(key) ?? 0, Number(e.meta?.ms ?? 0)))
      }
      expect(grouped.size).toBe(1)
    } finally {
      run.stop()
    }
  })
})
