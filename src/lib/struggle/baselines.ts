/**
 * Per-element struggle baselines.
 *
 * Computes per-element interaction patterns from historical UserEvent rows
 * and writes them to UIElement.extraction.baseline. The detector reads this
 * to adapt static thresholds - calm elements (delete buttons) trip earlier,
 * noisy elements (game UI, undo) trip later.
 *
 * Run periodically (cron) or after seed/import. Idempotent - overwrites the
 * baseline JSON in-place.
 */

import { prisma } from '@/lib/db'

export interface BaselineComputeResult {
  ok: boolean
  computed: number
  skipped: number
  totalElements: number
  errorMessages: string[]
}

const MIN_EVENTS = 30
const MIN_SESSIONS = 3
const MAX_ELEMENTS_PER_RUN = 200
const LOOKBACK_DAYS = 14

/**
 * For each element with enough event history, compute:
 *   - p95ClicksPerSec - sliding 1s window peaks across sessions
 *   - p95DwellMs - typical "stared at without acting" duration
 *   - p95HoversBeforeClick - typical hovers-per-session preceding a click
 *   - sampleSize - number of distinct sessions used
 */
export async function computeBaselinesForOrg(orgId: string): Promise<BaselineComputeResult> {
  const result: BaselineComputeResult = {
    ok: true,
    computed: 0,
    skipped: 0,
    totalElements: 0,
    errorMessages: [],
  }

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  // Every element with ANY persisted event activity in the window. CLICK /
  // DWELL / HOVER are all useful inputs - pre-filtering by CLICK alone
  // misses dwell-only surfaces (docs pages, code blocks, video heroes).
  const candidates = (await prisma.uIElement.findMany({
    where: {
      orgId,
      events: { some: { ts: { gte: cutoff } } },
    },
    select: { id: true, extraction: true } as never,
    take: MAX_ELEMENTS_PER_RUN,
  })) as Array<{ id: string; extraction: Record<string, unknown> | null }>
  result.totalElements = candidates.length

  if (candidates.length === 0) return result

  for (const el of candidates) {
    try {
      const events = (await prisma.userEvent.findMany({
        where: {
          orgId,
          elementId: el.id,
          ts: { gte: cutoff },
        },
        orderBy: { ts: 'asc' },
        select: { sessionId: true, ts: true, eventType: true, meta: true } as never,
      })) as Array<{
        sessionId: string
        ts: Date
        eventType: string
        meta: Record<string, unknown> | null
      }>
      if (events.length < MIN_EVENTS) {
        result.skipped++
        continue
      }

      const bySession = new Map<string, typeof events>()
      for (const e of events) {
        const arr = bySession.get(e.sessionId) ?? []
        arr.push(e)
        bySession.set(e.sessionId, arr)
      }
      if (bySession.size < MIN_SESSIONS) {
        result.skipped++
        continue
      }

      // Click rate (per-session sliding 1s window peaks)
      const clickRates: number[] = []
      for (const sessEvents of bySession.values()) {
        const clickTs = sessEvents.filter((e) => e.eventType === 'CLICK').map((e) => e.ts)
        for (let i = 0; i < clickTs.length; i++) {
          let count = 1
          for (let j = i + 1; j < clickTs.length; j++) {
            if (clickTs[j]!.getTime() - clickTs[i]!.getTime() <= 1000) count++
            else break
          }
          clickRates.push(count)
        }
      }

      // Hovers-per-session preceding the first click on this element. The
      // intuition: if the median user hovers 5 times before clicking on a
      // complex menu trigger, we shouldn't treat 5 hovers as "hover hunt."
      const hoversBeforeClickPerSession: number[] = []
      for (const sessEvents of bySession.values()) {
        const hovers = sessEvents.filter((e) => e.eventType === 'HOVER')
        const clicks = sessEvents.filter((e) => e.eventType === 'CLICK')
        if (hovers.length === 0 || clicks.length === 0) continue
        const firstClickAt = clicks[0]!.ts.getTime()
        const before = hovers.filter((h) => h.ts.getTime() < firstClickAt).length
        if (before > 0) hoversBeforeClickPerSession.push(before)
      }

      // Dwell durations from the DWELL events' meta.ms field. DWELLs fire
      // every ~30s of inactivity from the SDK; the higher percentiles tell
      // us what's normal for that surface.
      const dwellMsValues: number[] = []
      for (const sessEvents of bySession.values()) {
        for (const e of sessEvents) {
          if (e.eventType !== 'DWELL') continue
          const m = e.meta as { ms?: number } | null
          if (typeof m?.ms === 'number' && m.ms > 0) dwellMsValues.push(m.ms)
        }
      }

      const p95ClicksPerSec =
        clickRates.length > 0 ? percentile(clickRates, 0.95) : null
      const p95HoversBeforeClick =
        hoversBeforeClickPerSession.length > 0
          ? percentile(hoversBeforeClickPerSession, 0.95)
          : null
      const p95DwellMs = dwellMsValues.length > 0 ? percentile(dwellMsValues, 0.95) : null

      const baseline = {
        p95ClicksPerSec,
        p95DwellMs,
        p95HoversBeforeClick,
        sampleSize: bySession.size,
        computedAt: new Date().toISOString(),
      }

      const existing = (el.extraction ?? {}) as Record<string, unknown>
      const merged = { ...existing, baseline }

      await prisma.uIElement.update({
        where: { id: el.id },
        data: { extraction: merged as never },
      })
      result.computed++
    } catch (err) {
      result.errorMessages.push(
        err instanceof Error ? `${el.id}: ${err.message}` : `${el.id}: failure`,
      )
    }
  }

  result.ok = result.errorMessages.length === 0 || result.computed > 0
  return result
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))
  return sorted[idx]!
}
