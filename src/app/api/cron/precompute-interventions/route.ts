/**
 * Cron endpoint - runs the LLM intervention pre-computation worker for every
 * org that has DEEP-key access AND at least one enriched UIElement.
 *
 * Schedule: once per hour. The worker is rate-limited (16 elements per run)
 * so an hourly cadence keeps cost predictable while covering new elements
 * within ~hours of their first enrichment.
 *
 * Auth: shared CRON_SECRET in `Authorization: Bearer <secret>`.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { precomputeForOrg } from '@/lib/interventions/precompute'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected || !auth || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const orgs = await prisma.org.findMany({
    where: {
      keys: { some: { kind: 'DEEP' } },
      elements: { some: { semantics: { some: {} } } },
    },
    select: { id: true },
  })
  const results = []
  for (const org of orgs) {
    try {
      const r = await precomputeForOrg(org.id)
      results.push({
        orgId: org.id,
        ok: r.ok,
        generated: r.generated,
        skippedCached: r.skippedCached,
      })
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
