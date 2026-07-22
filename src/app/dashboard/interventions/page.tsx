import { revalidatePath } from 'next/cache'
import { getCurrentOrg } from '@/lib/access'
import { prisma } from '@/lib/db'
import {
  InterventionTable,
  type InterventionRow,
} from '@/components/dashboard/InterventionTable'
import { EmptyStateBanner } from '@/components/dashboard/EmptyStateBanner'
import { precomputeForOrg } from '@/lib/interventions/precompute'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatPercent } from '@/lib/utils'

export default async function InterventionsPage() {
  const ctx = await getCurrentOrg('/dashboard/interventions')
  const orgId = ctx.orgId

  const intervs = await prisma.intervention.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
      enabled: true,
      variantGroup: true,
      impressions: true,
      successes: true,
      dismissals: true,
      successRate: true,
      config: true,
      element: { select: { labelRaw: true } },
    },
  })

  const rows: InterventionRow[] = intervs.map((i) => {
    const config = i.config as { type?: string; copy?: string } | null
    let copy = ''
    if (config && typeof config.copy === 'string') copy = config.copy
    else if (i.type === 'DOM') copy = '(DOM mutation)'
    else if (i.type === 'BEHAVIOR') copy = '(behavior override)'
    else if (i.type === 'AUTO_FIX') copy = '(auto-fix)'

    return {
      id: i.id,
      copy,
      elementLabel: i.element.labelRaw,
      type: i.type,
      enabled: i.enabled,
      variantGroup: i.variantGroup,
      impressions: i.impressions,
      successes: i.successes,
      dismissals: i.dismissals,
      successRate: i.successRate,
    }
  })

  async function toggleEnabled(formData: FormData) {
    'use server'
    const c = await getCurrentOrg('/dashboard/interventions')
    const id = String(formData.get('id') ?? '')
    const next = String(formData.get('next') ?? '') === 'enable'
    if (!id) return
    await prisma.intervention.updateMany({
      where: { id, orgId: c.orgId },
      data: { enabled: next },
    })
    revalidatePath('/dashboard/interventions')
  }

  async function runPrecompute() {
    'use server'
    const c = await getCurrentOrg('/dashboard/interventions')
    await precomputeForOrg(c.orgId)
    revalidatePath('/dashboard/interventions')
  }

  const cachedCount = await prisma.interventionCache.count({ where: { orgId } })

  // Bandit leaderboard: across all (element, struggleType) pairs that have
  // both variants warm (≥30 impressions each), show the top 5 ordered by the
  // success-rate margin between winner and runner-up. This is the headline
  // "what's the bandit teaching us?" view.
  type BanditRow = {
    elementLabel: string | null
    struggleType: string
    winnerCopy: string
    winnerRate: number
    winnerImps: number
    loserRate: number
    loserImps: number
    margin: number
  }
  const banditLeaderboard: BanditRow[] = (() => {
    const groups = new Map<string, Array<(typeof intervs)[number]>>()
    for (const i of intervs) {
      const key = `${i.element.labelRaw ?? i.id}__${i.variantGroup ?? '_'}`
      const arr = groups.get(key) ?? []
      arr.push(i)
      groups.set(key, arr)
    }
    const rows: BanditRow[] = []
    for (const [, vs] of groups) {
      const warm = vs.filter((v) => v.impressions >= 30)
      if (warm.length < 2) continue
      const sorted = [...warm].sort((a, b) => b.successRate - a.successRate)
      const winner = sorted[0]!
      const loser = sorted[sorted.length - 1]!
      const cfg = winner.config as { copy?: string } | null
      rows.push({
        elementLabel: winner.element.labelRaw ?? '(unlabeled)',
        struggleType: winner.variantGroup ?? '(no group)',
        winnerCopy: (cfg?.copy ?? winner.type).slice(0, 100),
        winnerRate: winner.successRate,
        winnerImps: winner.impressions,
        loserRate: loser.successRate,
        loserImps: loser.impressions,
        margin: winner.successRate - loser.successRate,
      })
    }
    return rows.sort((a, b) => b.margin - a.margin).slice(0, 5)
  })()

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Interventions</h1>
          <p className="text-sm text-muted-foreground">
            Every &ldquo;Looks like you&rsquo;re trying to ___&rdquo; the system has fired,
            including A/B variants and their measured lift. Pause an intervention to stop
            dispatching it without losing its history.
          </p>
        </div>
        <form action={runPrecompute}>
          <Button type="submit" variant="outline" size="sm">
            Pre-compute interventions{cachedCount > 0 ? ` (${cachedCount} cached)` : ''}
          </Button>
        </form>
      </div>
      <p className="text-xs text-muted-foreground">
        Pre-computation generates LLM-tailored intervention copy per (element, struggle type) so
        runtime dispatch is template-free for the most common patterns. Uses your DEEP-tier API
        key.
      </p>
      {rows.length === 0 ? <EmptyStateBanner /> : null}

      {banditLeaderboard.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bandit leaderboard</CardTitle>
            <CardDescription>
              Pairs where one variant has decisively beaten another (both ≥ 30 impressions).
              Ordered by success-rate margin - the larger the gap, the more confident the win.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {banditLeaderboard.map((row, i) => (
              <div key={i} className="rounded-md border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      {row.struggleType}
                    </Badge>
                    <span className="text-sm font-medium">{row.elementLabel}</span>
                  </div>
                  <Badge variant="success" className="text-[10px]">
                    +{Math.round(row.margin * 100)}pp margin
                  </Badge>
                </div>
                <div className="mt-2 truncate text-sm text-muted-foreground">
                  {row.winnerCopy}
                </div>
                <div className="mt-2 flex items-center gap-4 text-xs tabular-nums text-muted-foreground">
                  <span>
                    Winner: <span className="font-medium text-foreground">{formatPercent(row.winnerRate)}</span>{' '}
                    ({row.winnerImps} imps)
                  </span>
                  <span>·</span>
                  <span>
                    Runner-up: {formatPercent(row.loserRate)} ({row.loserImps} imps)
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <InterventionTable rows={rows} toggleAction={toggleEnabled} />
    </div>
  )
}
