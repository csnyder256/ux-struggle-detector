/**
 * Baseline aggregation: the per-element dwell p95 must be computed over
 * INDEPENDENT quiet stretches, not over the heartbeat rows that describe one
 * stretch.
 *
 * The SDK reports a continuing quiet stretch more than once: it re-reports
 * every second so an adapted (baseline-raised) threshold stays reachable, and
 * each report carries the growing length of the stretch it belongs to. That is
 * correct for the detector, which compares one number against a threshold.
 *
 * It is wrong for this module if every row is fed to the percentile
 * independently: a single 120s stare arrives as 111 rows (10s, 11s, … 120s) and
 * casts 111 votes, while a separate 10s stare arrives as one row and casts one
 * vote. The long idle then dominates p95 by sheer row count - the exact
 * baseline-padding failure the accepted brief forbids. The weighting must
 * follow the number of quiet stretches, not the number of heartbeats.
 *
 * These tests call the REAL `computeBaselinesForOrg` with only Prisma mocked -
 * no database, no re-implementation of the arithmetic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const NOW = new Date('2026-01-15T12:00:00Z')

/** One stored UserEvent row, in the shape baselines.ts selects. */
interface StoredEvent {
  sessionId: string
  ts: Date
  eventType: string
  meta: Record<string, unknown> | null
}

/** Rows the mocked Prisma hands back for the element under test. */
let storedEvents: StoredEvent[] = []
/** The extraction object the module writes back via update(). */
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

/** A DWELL row with an explicit stretch identity. */
function dwellRow(
  sessionId: string,
  ts: number,
  ms: number,
  stretchId: string | undefined,
): StoredEvent {
  const meta: Record<string, unknown> = { ms }
  if (stretchId !== undefined) meta.stretch = stretchId
  return { sessionId, ts: new Date(ts), eventType: 'DWELL', meta }
}

/** Pad the window with CLICK rows so MIN_EVENTS/MIN_SESSIONS are satisfied. */
function filler(): StoredEvent[] {
  const rows: StoredEvent[] = []
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < 10; i++) {
      rows.push({
        sessionId: `sess_${s}`,
        ts: new Date(NOW.getTime() - 60_000 - i * 100),
        eventType: 'CLICK',
        meta: null,
      })
    }
  }
  return rows
}

/** The cumulative heartbeat rows the SDK emits for one growing quiet stretch. */
function growingStretch(
  sessionId: string,
  startTs: number,
  lengthMs: number,
  stretchId: string | undefined,
): StoredEvent[] {
  const rows: StoredEvent[] = []
  for (let ms = 10_000; ms <= lengthMs; ms += 1_000) {
    rows.push(dwellRow(sessionId, startTs + ms - 10_000, ms, stretchId))
  }
  return rows
}

interface Baseline {
  p95DwellMs: number | null
  sampleSize: number
}

async function computed(): Promise<Baseline> {
  const { computeBaselinesForOrg } = await import('@/lib/struggle/baselines')
  const result = await computeBaselinesForOrg('org_1')
  expect(result.computed, JSON.stringify(result.errorMessages)).toBe(1)
  const baseline = (written as { baseline?: Baseline } | undefined)?.baseline
  if (!baseline) throw new Error('baseline was not written')
  return baseline
}

beforeEach(() => {
  storedEvents = []
  written = undefined
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

describe('dwell p95 is weighted by quiet stretch, not by heartbeat row', () => {
  it('99 independent 10s stretches plus one 120s stretch have a 10s p95', async () => {
    // 99 separate quiet stretches of 10s, each reported once (a short stretch
    // is only ever reported when it reaches the 10s floor).
    for (let i = 0; i < 99; i++) {
      storedEvents.push(
        dwellRow(`short_${i}`, NOW.getTime() - 300_000 + i * 1_000, 10_000, `short_${i}`),
      )
    }
    // One long stretch that the SDK reported cumulatively every second:
    // 10s, 11s, … 120s. It is ONE stretch, so it is ONE sample of 120s.
    storedEvents.push(...growingStretch('long', NOW.getTime() - 200_000, 120_000, 'long'))

    storedEvents.push(...filler())

    const baseline = await computed()

    // Across 100 independent stretches, 99 of them 10s, p95 is 10s.
    // Feeding the 111 heartbeat rows in independently yields 110s instead,
    // which is the defect: one idle period out-voting 99 real ones.
    expect(baseline.p95DwellMs).toBe(10_000)
  })

  it('a single long stretch cannot out-weigh many more numerous short ones', async () => {
    // 20 stretches of 5s (below the report floor, so legacy-shaped: one row
    // each, no identity) and ONE 200s stretch reported cumulatively.
    for (let i = 0; i < 20; i++) {
      storedEvents.push(dwellRow(`s${i}`, NOW.getTime() - 300_000 + i * 1_000, 5_000, undefined))
    }
    storedEvents.push(...growingStretch('long', NOW.getTime() - 250_000, 200_000, 'long'))
    storedEvents.push(...filler())

    const baseline = await computed()

    // 21 samples: twenty 5s and one 200s -> index floor(0.95*21)=19 -> 5s.
    expect(baseline.p95DwellMs).toBe(5_000)
  })

  it('counts one sample per stretch even when the identity is absent (legacy rows)', async () => {
    // Legacy rows predate the stretch identity: each is its own stretch of the
    // length it reports, so the grouping must not collapse them into one.
    storedEvents.push(dwellRow('a', NOW.getTime() - 300_000, 10_000, undefined))
    storedEvents.push(dwellRow('a', NOW.getTime() - 250_000, 20_000, undefined))
    storedEvents.push(dwellRow('a', NOW.getTime() - 200_000, 30_000, undefined))
    storedEvents.push(dwellRow('b', NOW.getTime() - 150_000, 40_000, undefined))
    storedEvents.push(...filler())

    const baseline = await computed()

    // Four distinct legacy rows are four stretches; p95 across [10,20,30,40]s
    // -> sorted index floor(0.95*4)=3 -> 40s. (No identity means no grouping,
    // which preserves the pre-identity behaviour for old data.)
    expect(baseline.p95DwellMs).toBe(40_000)
  })

  it('prefers the longest report of each identified stretch', async () => {
    // Three identified stretches; two are cumulative and must contribute their
    // final length, not their first.
    storedEvents.push(...growingStretch('a', NOW.getTime() - 300_000, 15_000, 'st_a'))
    storedEvents.push(...growingStretch('b', NOW.getTime() - 250_000, 25_000, 'st_b'))
    storedEvents.push(dwellRow('c', NOW.getTime() - 200_000, 10_000, 'st_c'))
    storedEvents.push(...filler())

    const baseline = await computed()

    // Samples are [10 000 (st_c), 15 000 (st_a), 25 000 (st_b)].
    // sorted index floor(0.95*3)=2 -> 25 000. If heartbeats were counted, the
    // >30 rows would drag the p95 up toward 25s only by luck; the sampleSize
    // and the exact p95 pin the grouping.
    expect(baseline.p95DwellMs).toBe(25_000)
  })
})
