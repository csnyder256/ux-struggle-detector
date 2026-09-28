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

      // Dwell durations from the DWELL events' meta.ms field. The SDK reports a
      // continuing quiet stretch MORE THAN ONCE - it re-reports every second so
      // an adapted (baseline-raised) threshold stays reachable - and each report
      // carries the growing length of the stretch it belongs to. A 120s stare
      // therefore arrives as ~111 rows (10s, 11s, ... 120s).
      //
      // Those rows are heartbeats of ONE event, not 111 separate events. Feeding
      // each to the percentile independently lets a single long idle cast 111
      // votes against a 10s idle's one vote, so p95 tracks stare length rather
      // than typical behaviour - the baseline gets padded by exactly the element
      // that was quiet longest. So group the rows by the stretch they belong to
      // (SDK meta.stretch) and take ONE sample per stretch: its longest report.
      //
      // A stretch is identified by the PAIR (sessionId, meta.stretch), not by
      // the stretch string alone. The SDK mints its stretch id client-side from
      // a browser-local clock and a per-page counter, so the identical string
      // `st_abc_1` is guaranteed to collide across tabs, devices and users:
      // grouping on the bare string would fuse one quiet stretch from each of
      // those sessions into a single sample, letting a 120s stare in some other
      // session swallow 99 independent 10s stretches (and, worse, discarding
      // the other sessions' samples outright). The session is the only field
      // that separates two client-local stretch identities, so it is part of
      // the key. The key is a null-prototype record whose fields are length-
      // prefixed, because a joined string is ambiguous whenever one field can
      // contain the separator ("a\u0000b" + "c" vs "a" + "b\u0000c"); length
      // prefixes make two distinct (session, stretch) pairs two distinct keys.
      //
      // Legacy rows (written before the identity existed) have no meta.stretch.
      // Each has no way to be tied to another, so each is its own stretch of the
      // length it reports - which is the pre-identity behaviour, preserved
      // rather than guessed at. A row that carries an identity is grouped by it
      // even when it is the only row for that identity, so a mix of old and new
      // data degrades one row at a time instead of collapsing.
      const dwellByStretch = new Map<string, number>()
      let legacyDwellIndex = 0
      for (const sessEvents of bySession.values()) {
        for (const e of sessEvents) {
          if (e.eventType !== 'DWELL') continue
          const m = e.meta as { ms?: number; stretch?: unknown } | null
          if (typeof m?.ms !== 'number' || m.ms <= 0) continue
          // Untagged legacy rows are tied to nothing, not even to each other:
          // one key per row (its own index), under a discriminant that no
          // (session, stretch) pair can produce, so it can never merge with a
          // tagged stretch.
          const tagged = typeof m.stretch === 'string' && m.stretch.length > 0
          const key = tagged
            ? dwellStretchKey(e.sessionId, m.stretch as string)
            : `legacy\u0000${legacyDwellIndex++}`
          const previous = dwellByStretch.get(key)
          // The longest report describes the whole stretch; earlier heartbeats
          // are prefixes of it and contribute nothing on their own.
          if (previous === undefined || m.ms > previous) dwellByStretch.set(key, m.ms)
        }
      }
      const dwellMsValues: number[] = Array.from(dwellByStretch.values())

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

/**
 * Collision-safe identity for one quiet stretch: the (session, stretch) pair.
 *
 * The SDK's `meta.stretch` is minted client-side and is only unique within one
 * browser session, so the session is half the identity. Both fields are encoded
 * with an explicit byte length so no two distinct pairs can produce the same
 * key - a plain join is ambiguous the moment a field can contain the separator
 * or is a callable Map key (`sessionId.toString`), and both are reachable from
 * ingested data. The record has a null prototype so no field value can ever
 * collide with an inherited member name.
 */
function dwellStretchKey(sessionId: string, stretch: string): string {
  return JSON.stringify({ session: sessionId, stretch })
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))
  return sorted[idx]!
}
