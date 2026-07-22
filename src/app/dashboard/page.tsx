import { getCurrentOrg } from '@/lib/access'
import { prisma } from '@/lib/db'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyStateBanner } from '@/components/dashboard/EmptyStateBanner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatNumber, formatPercent, formatRelativeTime } from '@/lib/utils'

export default async function DashboardOverviewPage() {
  const ctx = await getCurrentOrg('/dashboard')
  const orgId = ctx.orgId

  const now = new Date()
  const startOfDay = new Date(now)
  startOfDay.setUTCHours(0, 0, 0, 0)

  const [
    eventsToday,
    eventsTotal,
    struggleToday,
    struggleTotal,
    activeIntervs,
    elementCount,
    enrichedCount,
    topFriction,
    topRoutes,
    recentStruggles,
    recentInterventions,
    config,
    latestEvent,
  ] = await Promise.all([
    prisma.userEvent.groupBy({
      by: ['sessionId'],
      where: { orgId, ts: { gte: startOfDay } },
      _count: { sessionId: true },
    }),
    prisma.userEvent.count({ where: { orgId } }),
    prisma.struggleEvent.count({ where: { orgId, ts: { gte: startOfDay } } }),
    prisma.struggleEvent.count({ where: { orgId } }),
    prisma.intervention.count({ where: { orgId, enabled: true } }),
    prisma.uIElement.count({ where: { orgId } }),
    prisma.uIElement.count({ where: { orgId, semantics: { some: {} } } }),
    prisma.struggleEvent.groupBy({
      by: ['elementId'],
      where: { orgId },
      _count: { elementId: true },
      orderBy: { _count: { elementId: 'desc' } },
      take: 1,
    }),
    prisma.struggleEvent.groupBy({
      by: ['type'],
      where: { orgId, ts: { gte: startOfDay } },
      _count: { _all: true },
      orderBy: { _count: { type: 'desc' } },
      take: 5,
    }),
    prisma.struggleEvent.findMany({
      where: { orgId },
      orderBy: { ts: 'desc' },
      take: 10,
      include: { element: { select: { labelRaw: true, routeTarget: true } } },
    }),
    prisma.intervention.findMany({
      where: { orgId },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        type: true,
        impressions: true,
        successes: true,
        dismissals: true,
        successRate: true,
        element: { select: { labelRaw: true } },
        updatedAt: true,
      },
    }),
    prisma.platformConfig.findUnique({ where: { orgId }, select: { safeMode: true } }),
    prisma.userEvent.findFirst({
      where: { orgId },
      orderBy: { ts: 'desc' },
      select: { ts: true },
    }),
  ])

  // Live-status heuristic. "Connected" = last event in the last 2 minutes.
  // "Idle" = last event 2 min – 24 h ago. "Disconnected" = older or never.
  const lastSeenMs = latestEvent ? now.getTime() - latestEvent.ts.getTime() : Infinity
  const liveStatus: 'connected' | 'idle' | 'disconnected' =
    lastSeenMs < 120_000
      ? 'connected'
      : lastSeenMs < 24 * 60 * 60 * 1000
        ? 'idle'
        : 'disconnected'

  const sessionsToday = eventsToday.length
  const topFrictionElementId = topFriction[0]?.elementId ?? null
  const topFrictionElement = topFrictionElementId
    ? await prisma.uIElement.findUnique({
        where: { id: topFrictionElementId },
        select: { labelRaw: true },
      })
    : null

  const showEmpty =
    sessionsToday === 0 && struggleToday === 0 && activeIntervs === 0 && eventsTotal === 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">
            A live read of struggle, sessions, and interventions across your platform.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LiveBadge status={liveStatus} lastSeenMs={lastSeenMs} />
          <Badge variant={config?.safeMode === false ? 'success' : 'secondary'}>
            {config?.safeMode === false ? 'Active' : 'Safe mode'}
          </Badge>
          <Badge variant="outline">
            {enrichedCount}/{elementCount} elements enriched
          </Badge>
        </div>
      </div>

      {showEmpty ? <EmptyStateBanner /> : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Sessions today" value={formatNumber(sessionsToday)} />
        <StatCard label="Struggles today" value={formatNumber(struggleToday)} />
        <StatCard label="Active interventions" value={formatNumber(activeIntervs)} />
        <StatCard
          label="Top friction"
          value={topFrictionElement?.labelRaw ?? ' - '}
          mode="text"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Events all-time" value={formatNumber(eventsTotal)} />
        <StatCard label="Struggles all-time" value={formatNumber(struggleTotal)} />
        <StatCard label="Mapped elements" value={formatNumber(elementCount)} />
        <StatCard label="Enriched" value={formatNumber(enrichedCount)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top struggle types today</CardTitle>
            <CardDescription>What&rsquo;s frustrating users in the last 24h.</CardDescription>
          </CardHeader>
          <CardContent>
            {topRoutes.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No struggles today.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topRoutes.map((s) => (
                    <TableRow key={s.type}>
                      <TableCell className="font-mono text-sm">{s.type}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(s._count._all)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent intervention activity</CardTitle>
            <CardDescription>
              Most-recently updated rows. Counts are denormalized from impression events.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentInterventions.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No interventions fired yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Element</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Imps</TableHead>
                    <TableHead className="text-right">Success</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentInterventions.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="max-w-[160px] truncate">
                        {i.element.labelRaw ?? '(unlabeled)'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px]">
                          {i.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{i.impressions}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {i.impressions > 0 ? formatPercent(i.successRate) : ' - '}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent struggle events</CardTitle>
          <CardDescription>Last 10 struggles across all sessions.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentStruggles.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No struggle events yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Element</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Severity</TableHead>
                  <TableHead className="text-right">Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentStruggles.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="max-w-[200px] truncate">
                      {s.element?.labelRaw ?? <span className="text-muted-foreground">(unmapped)</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.element?.routeTarget ?? ' - '}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {s.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.severity.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatRelativeTime(s.ts)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function LiveBadge({
  status,
  lastSeenMs,
}: {
  status: 'connected' | 'idle' | 'disconnected'
  lastSeenMs: number
}) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75"></span>
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
        </span>
        Live
      </span>
    )
  }
  if (status === 'idle') {
    const ago = formatLastSeen(lastSeenMs)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <span className="inline-flex h-2 w-2 rounded-full bg-amber-500"></span>
        Idle · {ago}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-muted-foreground/30 bg-muted/40 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      <span className="inline-flex h-2 w-2 rounded-full bg-muted-foreground"></span>
      No SDK signal
    </span>
  )
}

function formatLastSeen(ms: number): string {
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  return `${hr}h ago`
}

function StatCard({
  label,
  value,
  mode = 'number',
}: {
  label: string
  value: string
  mode?: 'number' | 'text'
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={
            mode === 'number'
              ? 'text-3xl font-semibold tabular-nums'
              : 'truncate text-lg font-medium'
          }
        >
          {value}
        </div>
      </CardContent>
    </Card>
  )
}
