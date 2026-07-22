import { getCurrentOrg } from '@/lib/access'
import { prisma } from '@/lib/db'
import { FlowMap, type FlowMapLink, type FlowMapNode } from '@/components/dashboard/FlowMap'
import { EmptyStateBanner } from '@/components/dashboard/EmptyStateBanner'

export default async function FlowsPage() {
  const ctx = await getCurrentOrg('/dashboard/flows')
  const orgId = ctx.orgId

  // Build a route → route Sankey from NAVIGATION events.
  // For MVP we read raw events; once volume requires it we move to a
  // pre-aggregated `RoutePair` table.
  const navEvents = await prisma.userEvent.findMany({
    where: { orgId, eventType: 'NAVIGATION' },
    select: { sessionId: true, route: true, ts: true },
    orderBy: { ts: 'asc' },
    take: 5000,
  })

  const sessionRoutes = new Map<string, string[]>()
  for (const e of navEvents) {
    const arr = sessionRoutes.get(e.sessionId) ?? []
    arr.push(e.route)
    sessionRoutes.set(e.sessionId, arr)
  }

  const pairCounts = new Map<string, number>()
  const routeIndex = new Map<string, number>()
  const nodes: FlowMapNode[] = []

  function getOrAddNode(name: string): number {
    const existing = routeIndex.get(name)
    if (existing !== undefined) return existing
    routeIndex.set(name, nodes.length)
    nodes.push({ name })
    return nodes.length - 1
  }

  for (const routes of sessionRoutes.values()) {
    for (let i = 0; i < routes.length - 1; i++) {
      const from = routes[i]!
      const to = routes[i + 1]!
      if (from === to) continue
      const key = `${from} → ${to}`
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
    }
  }

  const links: FlowMapLink[] = []
  for (const [key, count] of pairCounts) {
    const [from, to] = key.split(' → ') as [string, string]
    links.push({
      source: getOrAddNode(from),
      target: getOrAddNode(to),
      value: count,
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Flow Map</h1>
        <p className="text-sm text-muted-foreground">
          How users move through your routes. Width is session count.
        </p>
      </div>
      {nodes.length === 0 ? <EmptyStateBanner /> : null}
      <FlowMap nodes={nodes} links={links} />
    </div>
  )
}
