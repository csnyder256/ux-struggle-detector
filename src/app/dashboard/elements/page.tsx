import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { Sparkles, BarChart3 } from 'lucide-react'
import { getCurrentOrg } from '@/lib/access'
import { prisma } from '@/lib/db'
import { enrichOrg } from '@/lib/enrichment/enrich'
import { enrichRoutesForOrg } from '@/lib/enrichment/routes'
import { computeBaselinesForOrg } from '@/lib/struggle/baselines'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ElementTable, type ElementRow } from '@/components/dashboard/ElementTable'
import { EmptyStateBanner } from '@/components/dashboard/EmptyStateBanner'

interface SearchParams {
  searchParams?: Promise<{
    enriched?: string
    enrichedRoutes?: string
    baselined?: string
    errors?: string
    remaining?: string
    err?: string
  }>
}

export default async function ElementsPage({ searchParams }: SearchParams) {
  const ctx = await getCurrentOrg('/dashboard/elements')
  const orgId = ctx.orgId
  const params = (await searchParams) ?? {}

  const elements = await prisma.uIElement.findMany({
    where: { orgId },
    take: 200,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      labelRaw: true,
      routeTarget: true,
      filePath: true,
      semantics: {
        orderBy: { enrichedAt: 'desc' },
        take: 1,
        select: { semanticName: true },
      },
    },
  })

  const totalElements = await prisma.uIElement.count({ where: { orgId } })
  const enrichedElements = await prisma.uIElement.count({
    where: { orgId, semantics: { some: {} } },
  })
  const unenriched = totalElements - enrichedElements

  const struggleByElement = await prisma.struggleEvent.groupBy({
    by: ['elementId', 'type'],
    where: { orgId, elementId: { in: elements.map((e) => e.id) } },
    _count: { _all: true },
  })

  const topStruggle = new Map<string, string>()
  const struggleSeen = new Map<string, number>()
  for (const s of struggleByElement) {
    if (!s.elementId) continue
    const prev = struggleSeen.get(s.elementId) ?? 0
    if (s._count._all > prev) {
      struggleSeen.set(s.elementId, s._count._all)
      topStruggle.set(s.elementId, s.type)
    }
  }

  const rows: ElementRow[] = elements.map((el) => ({
    id: el.id,
    label: el.labelRaw,
    semanticName: el.semantics[0]?.semanticName ?? null,
    route: el.routeTarget,
    filePath: el.filePath,
    impressions: 0,
    successes: 0,
    topStruggleType: topStruggle.get(el.id) ?? null,
  }))

  async function runEnrichment() {
    'use server'
    const c = await getCurrentOrg('/dashboard/elements')
    const result = await enrichOrg(c.orgId)
    if (!result.ok && result.errorMessages.length > 0) {
      redirect(
        '/dashboard/elements?err=' + encodeURIComponent(result.errorMessages.join(' · ')),
      )
    }
    revalidatePath('/dashboard/elements')
    redirect(
      `/dashboard/elements?enriched=${result.enriched}&errors=${result.errors}&remaining=${Math.max(0, result.remaining - result.enriched)}`,
    )
  }

  async function runRouteEnrichment() {
    'use server'
    const c = await getCurrentOrg('/dashboard/elements')
    const result = await enrichRoutesForOrg(c.orgId)
    if (!result.ok && result.errorMessages.length > 0) {
      redirect(
        '/dashboard/elements?err=' + encodeURIComponent(result.errorMessages.join(' · ')),
      )
    }
    revalidatePath('/dashboard/elements')
    redirect(`/dashboard/elements?enrichedRoutes=${result.enriched}&errors=${result.errors}`)
  }

  async function runBaselineCompute() {
    'use server'
    const c = await getCurrentOrg('/dashboard/elements')
    const result = await computeBaselinesForOrg(c.orgId)
    if (!result.ok && result.errorMessages.length > 0) {
      redirect(
        '/dashboard/elements?err=' + encodeURIComponent(result.errorMessages.join(' · ')),
      )
    }
    revalidatePath('/dashboard/elements')
    redirect(`/dashboard/elements?baselined=${result.computed}`)
  }

  const totalRoutes = await prisma.uIRoute.count({ where: { orgId } })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Element Breakdown</h1>
          <p className="text-sm text-muted-foreground">
            Every interactive element in your platform map, plus its semantic name and the struggle
            patterns it&rsquo;s associated with.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={unenriched === 0 ? 'success' : 'secondary'}>
            {enrichedElements}/{totalElements} enriched
          </Badge>
          <form action={runEnrichment}>
            <Button type="submit" variant="outline" size="sm" disabled={totalElements === 0}>
              <Sparkles className="h-4 w-4" />
              Run enrichment{unenriched > 0 ? ` (${Math.min(32, unenriched)} pending)` : ''}
            </Button>
          </form>
          <form action={runRouteEnrichment}>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={totalRoutes === 0 || enrichedElements === 0}
              title="Pass 2 - synthesizes route-level purpose + journey stage from enriched elements"
            >
              <Sparkles className="h-4 w-4" />
              Enrich routes ({totalRoutes})
            </Button>
          </form>
          <form action={runBaselineCompute}>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={totalElements === 0}
              title="Compute per-element click-rate baselines so the detector adapts thresholds to noisy / calm elements"
            >
              <BarChart3 className="h-4 w-4" />
              Compute baselines
            </Button>
          </form>
        </div>
      </div>

      {params.enriched !== undefined ? (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          Enriched {params.enriched} element{params.enriched === '1' ? '' : 's'}.
          {params.errors && params.errors !== '0' ? ` ${params.errors} errors.` : ''}
          {params.remaining && params.remaining !== '0'
            ? ` ${params.remaining} still pending - click again to continue.`
            : ' All caught up.'}
        </div>
      ) : null}
      {params.enrichedRoutes !== undefined ? (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          Enriched {params.enrichedRoutes} route
          {params.enrichedRoutes === '1' ? '' : 's'} with purpose + journey stage.
          {params.errors && params.errors !== '0' ? ` ${params.errors} errors.` : ''}
        </div>
      ) : null}
      {params.baselined !== undefined ? (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          Computed baselines for {params.baselined} element
          {params.baselined === '1' ? '' : 's'} - detector thresholds will adapt on the next batch.
        </div>
      ) : null}
      {params.err ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Enrichment failed: {decodeURIComponent(params.err)}
        </div>
      ) : null}

      {rows.length === 0 ? <EmptyStateBanner /> : null}
      <ElementTable rows={rows} />
    </div>
  )
}
