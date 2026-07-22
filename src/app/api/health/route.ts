/**
 * Health endpoint - used by load balancers, uptime monitors, and the demo
 * page's "is the server up?" check. Returns:
 *   { ok: true, version, env: { node, requireAuth, providers: {...} }, db: { connected, latencyMs } }
 *
 * No auth required. Doesn't reveal sensitive info (no secrets, no DB schema).
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isOpenAccessMode } from '@/lib/access'
import { ingestKeyRequired } from '@/lib/auth/ingest'

export async function GET() {
  const start = Date.now()
  let dbConnected = false
  let dbLatencyMs = 0
  try {
    await prisma.$queryRaw`SELECT 1`
    dbConnected = true
    dbLatencyMs = Date.now() - start
  } catch {
    dbConnected = false
  }

  const githubAppConfigured = Boolean(
    process.env.GITHUB_APP_ID &&
      process.env.GITHUB_APP_CLIENT_ID &&
      process.env.GITHUB_APP_PRIVATE_KEY,
  )

  // Best-effort recent activity sample so uptime monitors / customers can
  // verify the SDK + pipeline are alive end-to-end. Skipped if DB is down.
  let recent: { events1h: number; struggles24h: number; interventions: number } | null = null
  if (dbConnected) {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const [events1h, struggles24h, interventions] = await Promise.all([
        prisma.userEvent.count({ where: { ts: { gte: oneHourAgo } } }),
        prisma.struggleEvent.count({ where: { ts: { gte: oneDayAgo } } }),
        prisma.intervention.count({ where: { enabled: true } }),
      ])
      recent = { events1h, struggles24h, interventions }
    } catch {
      // ignore - surface as null
    }
  }

  return NextResponse.json(
    {
      ok: dbConnected,
      version: process.env.npm_package_version ?? 'dev',
      uptime: Math.round(process.uptime()),
      env: {
        node: process.version,
        nodeEnv: process.env.NODE_ENV ?? 'development',
        openAccess: isOpenAccessMode(),
        requireAuth: process.env.REQUIRE_AUTH === 'true',
        requireIngestKey: ingestKeyRequired(),
        githubApp: githubAppConfigured ? 'configured' : 'not_configured',
      },
      db: {
        connected: dbConnected,
        latencyMs: dbLatencyMs,
      },
      activity: recent,
    },
    { status: dbConnected ? 200 : 503 },
  )
}
