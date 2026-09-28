/**
 * SDK -> backend dwell contract.
 *
 * These tests drive the ACTUAL SDK timer against a real jsdom document, capture
 * the events the SDK really emitted, and feed those captured events into the
 * real server detector. Nothing here re-implements SDK scheduling or detector
 * arithmetic - a copy of the arithmetic would pass while the real page never
 * emits the event the real rule needs.
 *
 * The contract the two sides owe each other: `detectLongDwell` compares
 * `meta.ms` against a threshold that a per-element baseline can raise above the
 * static 30s. So a DWELL event has to be able to report a quiet stretch at
 * least as long as any threshold it will be measured against, and one idle
 * stretch has to produce one stretch worth of evidence - not two rows, and not
 * a pile of short rows that an adapted threshold can never clear.
 *
 * The shape asserted here is the one that keeps both true at once: reports grow
 * through a single quiet stretch (so a long or adapted threshold is reachable),
 * and a single quiet stretch is reported once per second only while it lasts -
 * a resumed interaction starts a fresh count rather than re-adding the stretch
 * that was already reported.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { bootSdk, tick, dwellEvents, detect, moveMouse } from './helpers/sdk-dom'
import type { RuntimeEvent } from '@/lib/types/events'
import { DEFAULT_STRUGGLE_RULES } from '@/lib/types/events'

afterEach(async () => {
  const { vi } = await import('vitest')
  vi.useRealTimers()
})

/** Ticked the way a live page ticks, letting the SDK's own 1s timer fire. */
async function idleFor(ms: number, step = 1_000): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += step) await tick(step)
}

/**
 * Idle until the SDK has actually reported `targets` DWELL events, or the
 * wall-clock budget runs out. Under parallel test load the fake clock drops
 * ticks, so "advance 120s" does not guarantee 120 one-second wake-ups; waiting
 * on the observable report count makes these tests depend on the SDK's
 * behaviour rather than on how many ticks the scheduler delivered.
 */
async function idleUntilReports(
  run: { events: RuntimeEvent[] },
  targets: number,
  maxMs = 400_000,
): Promise<void> {
  const step = 1_000
  for (let elapsed = 0; elapsed < maxMs; elapsed += step) {
    if (dwellEvents(run.events).length >= targets) return
    await tick(step)
  }
}

function reported(events: RuntimeEvent[]): number[] {
  return events.map((e) => Number(e.meta?.ms ?? 0))
}

function longestReported(events: RuntimeEvent[]): number {
  return Math.max(0, ...reported(events))
}

/**
 * Every report reads as the length of the quiet stretch it belongs to: a
 * report may never be shorter than one that came before it inside a single
 * stretch. A count that restarts mid-stretch is the defect this pins.
 */
function reportsAreMonotonic(ms: number[]): boolean {
  for (let i = 1; i < ms.length; i++) if (ms[i]! <= ms[i - 1]!) return false
  return true
}

/**
 * A DWELL report can land up to one timer tick short of the wall-clock stretch:
 * the SDK checks on a 1s interval, and under a loaded CI box the last tick of a
 * quiet stretch can arrive just after the window ends. Everything asserted
 * about a stretch length allows that second, because pinning to the
 * millisecond would make the test measure tick scheduling instead of the
 * behaviour under test.
 */
const ONE_TICK = 1_000

describe('DWELL events survive backend long-dwell detection', () => {
  it('reports a growing quiet stretch, so an adapted threshold is reachable', async () => {
    // A reader who opened a tab and just read, interacting with nothing.
    const run = await bootSdk('<div id="hero">Docs</div>')
    try {
      await idleUntilReports(run, 111)
      const dwell = dwellEvents(run.events)
      const ms = reported(dwell)
      expect(ms.length).toBeGreaterThan(1)
      // The whole 120s quiet stretch is reported by the end of it, not just the
      // first tick that happened to clear a fixed threshold.
      expect(longestReported(dwell)).toBeGreaterThanOrEqual(120_000 - ONE_TICK)
      expect(reportsAreMonotonic(ms)).toBe(true)
      // A count that restarts mid-stretch cannot reach a baseline-raised bar.
      for (const value of ms) expect(value).toBeGreaterThanOrEqual(10_000)
    } finally {
      run.stop()
    }
  })

  it('a 2 minute stare clears an adapted 45s threshold on the element it names', async () => {
    // An element whose own p95 dwell is 30s: detectLongDwell raises its
    // threshold to max(30s, ceil(30s * 1.5)) = 45s, so nothing shorter than 45s
    // can ever be detected on it - the shape of a docs panel or a video hero.
    const p95DwellMs = 30_000
    const adaptedThreshold = Math.max(
      DEFAULT_STRUGGLE_RULES.longDwell.dwellMs,
      Math.ceil(p95DwellMs * 1.5),
    )
    expect(adaptedThreshold).toBe(45_000)

    const run = await bootSdk('<div id="panel"><button id="cta">Open guide</button></div>')
    try {
      const cta = run.doc.getElementById('cta')!
      moveMouse(cta) // the last thing the user touched before going quiet
      await idleUntilReports(run, 111)

      const dwell = dwellEvents(run.events)
      const elementId = dwell[0]?.elementId
      expect(elementId, 'DWELL must carry the element it was measured on').toBeTruthy()
      expect(dwell.every((e) => e.elementId === elementId)).toBe(true)
      expect(reportsAreMonotonic(reported(dwell))).toBe(true)

      const baselines = new Map([[elementId as string, { p95DwellMs, sampleSize: 30 }]])
      const dets = detect(run.events, baselines).filter((d) => d.type === 'LONG_DWELL')
      expect(dets).toHaveLength(1)
      expect(dets[0]?.summary).toMatch(/adapted threshold/)

      // The evidence that cleared the adapted rule must itself be at least that
      // long - a detection may never rest on a number its rule cannot act on.
      expect(longestReported(dwell)).toBeGreaterThanOrEqual(adaptedThreshold - ONE_TICK)
    } finally {
      run.stop()
    }
  })

  it('a 5 minute stare reaches an adapted 135s threshold', async () => {
    // p95 = 90s on a long-form page -> threshold 135s. A count that restarts
    // mid-stretch can never clear this, whatever the stare length.
    const p95DwellMs = 90_000
    const run = await bootSdk('<div id="hero">Docs</div>')
    try {
      await idleUntilReports(run, 291)
      const dwell = dwellEvents(run.events)
      expect(reportsAreMonotonic(reported(dwell))).toBe(true)
      const elementId = dwell[0]?.elementId as string
      const baselines = new Map([[elementId, { p95DwellMs, sampleSize: 30 }]])
      const dets = detect(run.events, baselines).filter((d) => d.type === 'LONG_DWELL')
      expect(dets).toHaveLength(1)
      expect(longestReported(dwell)).toBeGreaterThanOrEqual(135_000 - ONE_TICK)
    } finally {
      run.stop()
    }
  })

  it('resumed interaction starts a fresh stretch instead of inheriting the reported one', async () => {
    const run = await bootSdk('<div id="panel"><button id="cta">Open guide</button></div>')
    try {
      const cta = run.doc.getElementById('cta')!
      moveMouse(cta)
      await idleFor(40_000)
      const firstStretch = dwellEvents(run.events)
      expect(firstStretch.length).toBeGreaterThan(0)
      const elementId = firstStretch[0]!.elementId
      expect(elementId).toBeTruthy()
      const firstQuiet = reported(firstStretch).filter((ms) => ms >= 10_000)
      expect(reportsAreMonotonic(firstQuiet)).toBe(true)
      expect(firstQuiet[firstQuiet.length - 1]).toBeGreaterThanOrEqual(20_000)
      const firstPeak = firstQuiet[firstQuiet.length - 1]!

      // The user comes back, does something, then leaves again. A mousemove and
      // the 1s tick race, so one final report for the *first* stretch can land
      // just after the interaction; that is the last report at or above where
      // the first stretch got. Everything after it belongs to the second
      // stretch and must count from the 10s floor rather than continuing on
      // from the first stretch's total.
      moveMouse(cta)
      await tick(5_000)
      await idleFor(40_000)

      const all = reported(dwellEvents(run.events))
      // The first stretch's terminal report is the highest value that is still
      // immediately preceded by a run of increasing values starting at 10s -
      // the raced tail report (40s) is the end of that run.
      let endOfFirst = 0
      for (let i = 1; i < all.length; i++) {
        if (all[i]! <= all[i - 1]!) {
          endOfFirst = i - 1
          break
        }
      }
      expect(endOfFirst, 'the first stretch has reports').toBeGreaterThan(0)
      expect(all[endOfFirst]).toBeGreaterThanOrEqual(20_000)

      // Everything after it belongs to the second stretch and must count from
      // the 10s floor rather than continuing on from the first stretch's total.
      const afterFirst = all.slice(endOfFirst + 1)
      expect(afterFirst.length, 'the second quiet stretch reports').toBeGreaterThan(0)
      expect(afterFirst[0], 'the second stretch reports from its own floor').toBe(10_000)
      // ... and then grows again on its own, to at most the 40s+5s it measured.
      expect(afterFirst[afterFirst.length - 1]).toBeLessThanOrEqual(45_000)

      // Two quiet stretches on one element are one detection per pass:
      // detectStruggles dedupes on (sessionId, elementId, type).
      const dets = detect(run.events).filter((d) => d.type === 'LONG_DWELL')
      expect(dets).toHaveLength(1)
      expect(dets[0]?.elementId).toBe(elementId)
    } finally {
      run.stop()
    }
  })

  it('a single quiet stretch is not re-dated into duplicate baseline rows', async () => {
    const run = await bootSdk('<div id="hero">Docs</div>')
    try {
      await idleUntilReports(run, 111)
      const dwell = dwellEvents(run.events)
      const ms = reported(dwell)
      // Each report covers strictly more quiet time than the last, so no two
      // rows describe the same stretch and the dwell baseline is not fed the
      // same idle period twice.
      const distinct = new Set(ms)
      expect(distinct.size).toBe(ms.length)
      expect(reportsAreMonotonic(ms)).toBe(true)
    } finally {
      run.stop()
    }
  })
})
