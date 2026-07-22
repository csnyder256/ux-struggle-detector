/**
 * Cron endpoint - computes per-element baselines for every org.
 *
 * Schedule (Vercel Cron compatible): once per day at 04:00 UTC.
 * Auth: shared CRON_SECRET in the `Authorization: Bearer <secret>` header.
 *
 * Idempotent. Safe to run more often.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { computeBaselinesForOrg } from '@/lib/struggle/baselines'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected || !auth || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const orgs = await prisma.org.findMany({ select: { id: true } })
  const results = []
  for (const org of orgs) {
    try {
      const r = await computeBaselinesForOrg(org.id)
      results.push({ orgId: org.id, ok: r.ok, computed: r.computed, skipped: r.skipped })
    } catch (err) {
      results.push({
        orgId: org.id,
        ok: false,
        error: err instanceof Error ? err.message : 'unknown',
      })
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    orgsProcessed: orgs.length,
    results,
  })
}

export const POST = GET
