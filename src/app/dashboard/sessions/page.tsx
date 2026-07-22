import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { getCurrentOrg } from '@/lib/access'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyStateBanner } from '@/components/dashboard/EmptyStateBanner'
import { formatNumber, formatRelativeTime } from '@/lib/utils'

interface SearchParams {
  searchParams?: Promise<{ id?: string }>
}

export default async function SessionsPage({ searchParams }: SearchParams) {
  const ctx = await getCurrentOrg('/dashboard/sessions')
  const orgId = ctx.orgId
  const params = (await searchParams) ?? {}

  if (params.id) {
    return <SessionDetail orgId={orgId} sessionId={params.id} />
  }

  // Top-level: list recent sessions with event + struggle counts.
  const eventGroups = await prisma.userEvent.groupBy({
    by: ['sessionId'],
    where: { orgId },
    _count: { _all: true },
    _max: { ts: true },
    _min: { ts: true },
    orderBy: { _max: { ts: 'desc' } },
    take: 50,
  })

  const sessionIds = eventGroups.map((g) => g.sessionId)
  const struggleGroups = await prisma.struggleEvent.groupBy({
    by: ['sessionId'],
    where: { orgId, sessionId: { in: sessionIds } },
    _count: { _all: true },
  })
  const struggleCount = new Map(struggleGroups.map((g) => [g.sessionId, g._count._all]))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
        <p className="text-sm text-muted-foreground">
          Recent user sessions. Click into one to see the event timeline.
        </p>
      </div>

      {eventGroups.length === 0 ? <EmptyStateBanner /> : null}

      {eventGroups.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Session</TableHead>
              <TableHead className="text-right">Events</TableHead>
              <TableHead className="text-right">Struggles</TableHead>
              <TableHead className="text-right">Started</TableHead>
              <TableHead className="text-right">Last seen</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {eventGroups.map((g) => (
              <TableRow key={g.sessionId}>
                <TableCell className="max-w-[280px] truncate font-mono text-xs">
                  {g.sessionId}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(g._count._all)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {struggleCount.get(g.sessionId) ?? 0}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {g._min.ts ? formatRelativeTime(g._min.ts) : ' - '}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {g._max.ts ? formatRelativeTime(g._max.ts) : ' - '}
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/dashboard/sessions?id=${encodeURIComponent(g.sessionId)}`}>
                    <span className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                      Open
                      <ArrowRight className="h-3 w-3" />
                    </span>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  )
}

async function SessionDetail({ orgId, sessionId }: { orgId: string; sessionId: string }) {
  const events = await prisma.userEvent.findMany({
    where: { orgId, sessionId },
    orderBy: { ts: 'asc' },
    take: 500,
    include: { element: { select: { labelRaw: true, elementType: true } } },
  })

  const struggles = await prisma.struggleEvent.findMany({
    where: { orgId, sessionId },
    orderBy: { ts: 'asc' },
    include: { element: { select: { labelRaw: true } } },
  })

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/sessions" className="text-sm text-muted-foreground hover:underline">
          ← All sessions
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Session detail</h1>
        <p className="font-mono text-sm text-muted-foreground">{sessionId}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Struggles fired ({struggles.length})</CardTitle>
          <CardDescription>What went wrong, in order.</CardDescription>
        </CardHeader>
        <CardContent>
          {struggles.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No struggles in this session. Smooth ride.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Element</TableHead>
                  <TableHead className="text-right">Severity</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {struggles.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {s.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate">
                      {s.elementId ? (
                        <Link
                          href={`/dashboard/elements/${encodeURIComponent(s.elementId)}`}
                          className="text-primary hover:underline"
                        >
                          {s.element?.labelRaw ?? '(unlabeled)'}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">(unmapped)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.severity.toFixed(2)}
                    </TableCell>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event timeline ({events.length})</CardTitle>
          <CardDescription>Raw events as the SDK delivered them.</CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No events for this session id.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Element / Route</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {e.eventType}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[400px] truncate">
                      {e.elementId ? (
                        <Link
                          href={`/dashboard/elements/${encodeURIComponent(e.elementId)}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {e.element?.labelRaw ?? '(unlabeled)'}
                        </Link>
                      ) : (
                        <span className="font-medium">{e.element?.labelRaw ?? ' - '}</span>
                      )}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {e.route}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatRelativeTime(e.ts)}
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
