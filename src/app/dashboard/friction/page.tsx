import Link from 'next/link'
import { getCurrentOrg } from '@/lib/access'
import { prisma } from '@/lib/db'
import { ALL_STRUGGLE_TYPES } from '@/lib/types/events'
import { FrictionTable, type FrictionRow } from '@/components/dashboard/FrictionTable'
import { EmptyStateBanner } from '@/components/dashboard/EmptyStateBanner'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface SearchParams {
  searchParams?: Promise<{ type?: string; window?: string }>
}

const WINDOW_OPTIONS: Array<{ key: string; label: string; ms: number | null }> = [
  { key: '24h', label: 'Last 24h', ms: 24 * 60 * 60 * 1000 },
  { key: '7d', label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: '30d', label: 'Last 30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { key: 'all', label: 'All time', ms: null },
]

export default async function FrictionPage({ searchParams }: SearchParams) {
  const ctx = await getCurrentOrg('/dashboard/friction')
  const orgId = ctx.orgId
  const params = (await searchParams) ?? {}

  const filterType = typeof params.type === 'string' && params.type !== 'all' ? params.type : null
  const windowKey = params.window && WINDOW_OPTIONS.some((w) => w.key === params.window)
    ? params.window
    : '7d'
  const windowMs = WINDOW_OPTIONS.find((w) => w.key === windowKey)!.ms

  const where: { orgId: string; type?: { equals: string }; ts?: { gte: Date } } = { orgId }
  if (filterType) where.type = { equals: filterType }
  if (windowMs !== null) where.ts = { gte: new Date(Date.now() - windowMs) }

  const grouped = await prisma.struggleEvent.groupBy({
    by: ['elementId', 'type'],
    where: where as never,
    _count: { _all: true },
    _avg: { severity: true },
    _max: { ts: true },
    orderBy: { _count: { elementId: 'desc' } },
    take: 100,
  })

  const elementIds = Array.from(
    new Set(grouped.map((g) => g.elementId).filter((id): id is string => Boolean(id))),
  )
  const elements = elementIds.length
    ? await prisma.uIElement.findMany({
        where: { id: { in: elementIds } },
        select: { id: true, labelRaw: true, routeTarget: true },
      })
    : []
  const elementMap = new Map(elements.map((e) => [e.id, e]))

  const rows: FrictionRow[] = grouped.map((g) => {
    const el = g.elementId ? elementMap.get(g.elementId) : null
    return {
      id: `${g.elementId ?? 'null'}_${g.type}`,
      elementLabel: el?.labelRaw ?? null,
      elementId: g.elementId,
      route: el?.routeTarget ?? ' - ',
      type: g.type,
      severity: g._avg.severity ?? 0,
      occurrences: g._count._all,
      lastSeen: (g._max.ts ?? new Date()).toISOString(),
    }
  })

  // Type counts for the filter chips (always show counts in the active window).
  const typeWhere: { orgId: string; ts?: { gte: Date } } = { orgId }
  if (windowMs !== null) typeWhere.ts = { gte: new Date(Date.now() - windowMs) }
  const typeCounts = await prisma.struggleEvent.groupBy({
    by: ['type'],
    where: typeWhere as never,
    _count: { _all: true },
    orderBy: { _count: { type: 'desc' } },
  })
  const totalInWindow = typeCounts.reduce((acc, t) => acc + t._count._all, 0)

  function url(t: string | null, w?: string) {
    const u = new URLSearchParams()
    if (t) u.set('type', t)
    u.set('window', w ?? windowKey)
    return `/dashboard/friction?${u.toString()}`
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Friction Points</h1>
          <p className="text-sm text-muted-foreground">
            Ranked by occurrence. {totalInWindow} struggle{totalInWindow === 1 ? '' : 's'} in the
            selected window.
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {WINDOW_OPTIONS.map((w) => (
            <Link key={w.key} href={url(filterType, w.key)}>
              <span
                className={cn(
                  'inline-flex items-center rounded-md border px-2.5 py-1 text-xs',
                  w.key === windowKey
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:bg-accent',
                )}
              >
                {w.label}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Link href={url(null)}>
          <Badge variant={filterType === null ? 'default' : 'outline'} className="cursor-pointer">
            All ({totalInWindow})
          </Badge>
        </Link>
        {ALL_STRUGGLE_TYPES.filter((t) =>
          typeCounts.some((tc) => tc.type === t),
        ).map((t) => {
          const count = typeCounts.find((tc) => tc.type === t)?._count._all ?? 0
          return (
            <Link key={t} href={url(t)}>
              <Badge
                variant={filterType === t ? 'default' : 'outline'}
                className="cursor-pointer"
              >
                {t.replace(/_/g, ' ').toLowerCase()} ({count})
              </Badge>
            </Link>
          )
        })}
      </div>

      {rows.length === 0 ? <EmptyStateBanner /> : null}
      <FrictionTable rows={rows} />
    </div>
  )
}
