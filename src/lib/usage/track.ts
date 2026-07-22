/**
 * Usage metering (Phase 15 of plan).
 *
 * Counts MAU, events, deep tokens, fast tokens, and interventions shown per
 * org per month. Surfaced in the dashboard so customers self-serve before
 * billing surprises.
 *
 * The schema rolls up to a single row per (orgId, month-start). All bumps
 * are increment-style upserts.
 */

import { prisma } from '@/lib/db'

export interface UsageBump {
  events?: number
  deepTokens?: number
  fastTokens?: number
  interventionsShown?: number
  /** When provided, recorded into MAU only if this hash isn't already counted in the period. Best effort. */
  userIdHash?: string | null
}

/**
 * Bump usage counters for the current UTC month.
 *
 * Errors are swallowed - usage tracking must never fail a real user request.
 */
export async function bumpUsage(orgId: string, bump: UsageBump): Promise<void> {
  const month = monthStartUTC(new Date())
  try {
    await prisma.usageMonth.upsert({
      where: { orgId_month: { orgId, month } },
      create: {
        orgId,
        month,
        events: bump.events ?? 0,
        deepTokens: BigInt(bump.deepTokens ?? 0),
        fastTokens: BigInt(bump.fastTokens ?? 0),
        interventionsShown: bump.interventionsShown ?? 0,
        mau: bump.userIdHash ? 1 : 0,
      },
      update: {
        events: bump.events ? { increment: bump.events } : undefined,
        deepTokens: bump.deepTokens ? { increment: BigInt(bump.deepTokens) } : undefined,
        fastTokens: bump.fastTokens ? { increment: BigInt(bump.fastTokens) } : undefined,
        interventionsShown: bump.interventionsShown
          ? { increment: bump.interventionsShown }
          : undefined,
      },
    })
  } catch {
    // Best effort.
  }
}

/** Current calendar month, midnight UTC, day 1. */
export function monthStartUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

/** Pull the most recent N months for an org, newest first. */
export async function recentUsage(orgId: string, months: number = 6) {
  const start = monthStartUTC(new Date())
  start.setUTCMonth(start.getUTCMonth() - (months - 1))
  return prisma.usageMonth.findMany({
    where: { orgId, month: { gte: start } },
    orderBy: { month: 'desc' },
  })
}

/**
 * Mark a set of `userIdHash` values as seen this month. createMany with
 * skipDuplicates against the unique index makes this O(N) inserts where
 * duplicates are server-side no-ops. Call from `/api/events` per batch.
 */
export async function trackActiveUsers(orgId: string, hashes: string[]): Promise<void> {
  const filtered = hashes.filter((h): h is string => Boolean(h))
  if (filtered.length === 0) return
  const monthStart = monthStartUTC(new Date())
  try {
    await prisma.monthlyActiveUser.createMany({
      data: filtered.map((userIdHash) => ({ orgId, userIdHash, monthStart })),
      skipDuplicates: true,
    })
  } catch {
    // Best effort.
  }
}

/** True MAU for the current month. */
export async function currentMonthMAU(orgId: string): Promise<number> {
  const monthStart = monthStartUTC(new Date())
  return prisma.monthlyActiveUser.count({ where: { orgId, monthStart } })
}
