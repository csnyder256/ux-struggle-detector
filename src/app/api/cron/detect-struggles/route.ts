/**
 * Cron endpoint - runs the struggle detector against recent UserEvents and
 * persists any new StruggleEvent rows. Catches struggles that span batches
 * (e.g. CIRCULAR_NAV across a 10-minute browse).
 *
 * Schedule: every 5 minutes.
 * Auth: shared CRON_SECRET in the `Authorization: Bearer <secret>` header.
 *
 * Idempotent. The (sessionId, elementId, type) dedup in the detector keeps
 * us from double-creating struggles within a window.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { detectStruggles } from '@/lib/struggle/detect'
import {
  ALL_STRUGGLE_TYPES,
  type RuntimeEvent,
  type StruggleType,
} from '@/lib/types/events'

const STRUGGLE_TYPE_SET = new Set<string>(ALL_STRUGGLE_TYPES)

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected || !auth || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const lookback = new Date(Date.now() - 30 * 60 * 1000) // 30 min
  const orgs = await prisma.org.findMany({ select: { id: true } })
  let totalDetections = 0
  let totalPersisted = 0
  const errors: string[] = []

  for (const org of orgs) {
    try {
      // Pull baselines + events for this org.
      const events = (await prisma.userEvent.findMany({
        where: { orgId: org.id, ts: { gte: lookback } },
        orderBy: { ts: 'asc' },
        take: 5000,
        select: {
          id: true,
          sessionId: true,
          userIdHash: true,
          elementId: true,
          route: true,
          eventType: true,
          ts: true,
          idempotencyKey: true,
          schemaVersion: true,
          meta: true,
        } as never,
      })) as Array<{
        id: string
        sessionId: string
        userIdHash: string | null
        elementId: string | null
        route: string
        eventType: string
        ts: Date
        idempotencyKey: string | null
        schemaVersion: number
        meta: Record<string, unknown> | null
      }>

      const runtimeEvents: RuntimeEvent[] = events.map((e) => ({
        schemaVersion: 2,
        idempotencyKey: e.idempotencyKey ?? `db_${e.id}`,
        sessionId: e.sessionId,
        userIdHash: e.userIdHash,
        elementId: e.elementId as RuntimeEvent['elementId'],
        route: e.route,
        eventType: e.eventType as RuntimeEvent['eventType'],
        ts: e.ts.toISOString(),
        meta: (e.meta ?? {}) as RuntimeEvent['meta'],
      }))

      // Pull baselines for each unique element so detector can adapt thresholds.
      const elementIds = Array.from(
        new Set(
          runtimeEvents
            .map((e) => e.elementId as string | null)
            .filter((id): id is string => Boolean(id)),
        ),
      )
      const baselines = new Map<
        string,
        { p95ClicksPerSec?: number | null; p95DwellMs?: number | null; sampleSize?: number }
      >()
      if (elementIds.length > 0) {
        const els = (await prisma.uIElement.findMany({
          where: { id: { in: elementIds } },
          select: { id: true, extraction: true } as never,
        })) as Array<{ id: string; extraction: Record<string, unknown> | null }>
        for (const el of els) {
          const ext = (el.extraction ?? {}) as { baseline?: typeof baselines extends Map<string, infer V> ? V : never }
          if (ext.baseline) baselines.set(el.id, ext.baseline)
        }
      }

      const detections = detectStruggles(runtimeEvents, { baselines })
      totalDetections += detections.length

      for (const d of detections) {
        if (!STRUGGLE_TYPE_SET.has(d.type)) continue
        try {
          // Avoid creating an exact duplicate within this batch run by
          // checking for an existing struggle with the same shape.
          const existing = await prisma.struggleEvent.findFirst({
            where: {
              orgId: org.id,
              sessionId: d.sessionId,
              elementId: d.elementId,
              type: d.type as StruggleType as never,
              ts: { gte: lookback },
            },
            select: { id: true },
          })
          if (existing) continue
          await prisma.struggleEvent.create({
            data: {
              orgId: org.id,
              sessionId: d.sessionId,
              elementId: d.elementId,
              type: d.type as StruggleType as never,
              severity: d.severity,
              ts: new Date(d.ts),
            },
          })
          totalPersisted++
        } catch (err) {
          errors.push(
            err instanceof Error ? err.message : 'persist failure',
          )
        }
      }
    } catch (err) {
      errors.push(
        org.id +
          ': ' +
          (err instanceof Error ? err.message : 'unknown'),
      )
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    orgsProcessed: orgs.length,
    totalDetections,
    totalPersisted,
    errors: errors.slice(0, 20),
  })
}

export const POST = GET
