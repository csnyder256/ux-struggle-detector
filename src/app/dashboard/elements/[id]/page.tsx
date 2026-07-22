import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowRight } from 'lucide-react'
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
import { formatNumber, formatPercent, formatRelativeTime } from '@/lib/utils'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ElementDetailPage({ params }: PageProps) {
  const { id } = await params
  const ctx = await getCurrentOrg(`/dashboard/elements/${id}`)
  const orgId = ctx.orgId

  const element = (await prisma.uIElement.findUnique({
    where: { id },
    select: {
      id: true,
      orgId: true,
      labelRaw: true,
      filePath: true,
      componentName: true,
      elementType: true,
      handlerFunction: true,
      routeTarget: true,
      semanticRole: true,
      formContext: true,
      extraction: true,
      createdAt: true,
      semantics: {
        orderBy: { enrichedAt: 'desc' },
        take: 1,
      },
    } as never,
  })) as
    | {
        id: string
        orgId: string
        labelRaw: string | null
        filePath: string
        componentName: string | null
        elementType: string
        handlerFunction: string | null
        routeTarget: string | null
        semanticRole: string | null
        formContext: string | null
        extraction: Record<string, unknown> | null
        createdAt: Date
        semantics: Array<{
          semanticName: string
          intent: string
          expectedOutcome: string
          failureModes: unknown
          extraction: Record<string, unknown> | null
          enrichedAt: Date
        }>
      }
    | null

  if (!element || element.orgId !== orgId) {
    notFound()
  }

  const sem = element.semantics[0] ?? null
  const richSem = (sem?.extraction ?? {}) as {
    helpCopy?: string
    alternativeActions?: string[]
    dependencies?: string[]
    riskLevel?: string
  }
  const failureModes = Array.isArray(sem?.failureModes) ? (sem.failureModes as string[]) : []

  const [struggles, intervs, cache, recentEvents, route] = await Promise.all([
    prisma.struggleEvent.findMany({
      where: { orgId, elementId: id },
      orderBy: { ts: 'desc' },
      take: 25,
      select: { id: true, sessionId: true, type: true, severity: true, ts: true },
    }),
    prisma.intervention.findMany({
      where: { orgId, elementId: id },
      select: {
        id: true,
        type: true,
        config: true,
        impressions: true,
        successes: true,
        dismissals: true,
        successRate: true,
        enabled: true,
        variantGroup: true,
      },
      orderBy: { successRate: 'desc' },
    }),
    prisma.interventionCache.findMany({
      where: { orgId, elementId: id },
      orderBy: [{ struggleType: 'asc' }, { variantIndex: 'asc' }],
      select: {
        id: true,
        struggleType: true,
        variantIndex: true,
        type: true,
        copy: true,
        title: true,
        helpCopy: true,
        confidence: true,
      },
    }),
    prisma.userEvent.findMany({
      where: { orgId, elementId: id },
      orderBy: { ts: 'desc' },
      take: 20,
      select: { id: true, sessionId: true, eventType: true, ts: true, route: true },
    }),
    element.routeTarget
      ? prisma.uIRoute.findUnique({
          where: { orgId_path: { orgId, path: element.routeTarget } },
          select: { path: true, title: true, description: true, extraction: true } as never,
        })
      : Promise.resolve(null),
  ])

  const struggleSessions = Array.from(new Set(struggles.map((s) => s.sessionId)))
  const struggleByType = new Map<string, number>()
  for (const s of struggles) {
    struggleByType.set(s.type, (struggleByType.get(s.type) ?? 0) + 1)
  }
  const topStruggleTypes = Array.from(struggleByType.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  const routeSemantic =
    ((route as { extraction?: { routeSemantic?: { purpose?: string; journeyStage?: string } } } | null)
      ?.extraction?.routeSemantic) ?? null

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/elements"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-3 w-3" />
          All elements
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {sem?.semanticName ?? element.labelRaw ?? '(unlabeled)'}
        </h1>
        <p className="font-mono text-xs text-muted-foreground">{element.id}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Static map</CardTitle>
            <CardDescription>What the parser found in your repo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Field label="Type" value={<Badge variant="outline">{element.elementType}</Badge>} />
            <Field label="Label" value={element.labelRaw ?? ' - '} />
            <Field label="Component" value={element.componentName ?? ' - '} />
            <Field label="Handler" value={element.handlerFunction ?? ' - '} />
            <Field label="File" value={<span className="font-mono text-xs">{element.filePath}</span>} />
            <Field
              label="Semantic role"
              value={element.semanticRole ? <Badge>{element.semanticRole}</Badge> : ' - '}
            />
            <Field label="Form" value={element.formContext ?? ' - '} />
            <Field
              label="Route"
              value={
                element.routeTarget ? (
                  <span className="font-mono text-xs">{element.routeTarget}</span>
                ) : (
                  ' - '
                )
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Semantic enrichment</CardTitle>
            <CardDescription>What the LLM thinks the user wants from this.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {sem ? (
              <>
                <Field label="Intent" value={sem.intent} />
                <Field label="Expected outcome" value={sem.expectedOutcome} />
                {richSem.helpCopy ? (
                  <Field label="Help copy" value={<span className="italic">{richSem.helpCopy}</span>} />
                ) : null}
                {failureModes.length > 0 ? (
                  <Field
                    label="Failure modes"
                    value={
                      <ul className="list-disc pl-5 text-muted-foreground">
                        {failureModes.map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                      </ul>
                    }
                  />
                ) : null}
                {richSem.alternativeActions && richSem.alternativeActions.length > 0 ? (
                  <Field
                    label="Alternatives"
                    value={
                      <div className="flex flex-wrap gap-1">
                        {richSem.alternativeActions.map((a, i) => (
                          <Badge key={i} variant="secondary" className="text-[10px]">
                            {a}
                          </Badge>
                        ))}
                      </div>
                    }
                  />
                ) : null}
                {richSem.dependencies && richSem.dependencies.length > 0 ? (
                  <Field
                    label="Depends on"
                    value={
                      <div className="flex flex-wrap gap-1">
                        {richSem.dependencies.map((d, i) => (
                          <Badge key={i} variant="outline" className="text-[10px]">
                            {d}
                          </Badge>
                        ))}
                      </div>
                    }
                  />
                ) : null}
                <Field
                  label="Risk"
                  value={
                    richSem.riskLevel === 'high' ? (
                      <Badge variant="destructive">high</Badge>
                    ) : richSem.riskLevel === 'medium' ? (
                      <Badge variant="warning">medium</Badge>
                    ) : (
                      <Badge variant="secondary">low</Badge>
                    )
                  }
                />
                <Field label="Last enriched" value={formatRelativeTime(sem.enrichedAt)} />
              </>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Not yet enriched. Click <em>Run enrichment</em> on the elements page.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {routeSemantic ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Route context</CardTitle>
            <CardDescription>Pass-2 enrichment on this element&rsquo;s route.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Field label="Purpose" value={routeSemantic.purpose ?? ' - '} />
            <Field
              label="Journey stage"
              value={
                routeSemantic.journeyStage ? (
                  <Badge variant="secondary">{routeSemantic.journeyStage}</Badge>
                ) : (
                  ' - '
                )
              }
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Top struggles ({struggles.length} recent · {struggleSessions.length} sessions)
          </CardTitle>
          <CardDescription>Where this element trips users up.</CardDescription>
        </CardHeader>
        <CardContent>
          {struggles.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No recorded struggles for this element.
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                {topStruggleTypes.map(([type, count]) => (
                  <Badge key={type} variant="outline" className="text-[11px]">
                    {type} · {count}
                  </Badge>
                ))}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Session</TableHead>
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
                      <TableCell className="max-w-[260px]">
                        <Link
                          href={`/dashboard/sessions?id=${encodeURIComponent(s.sessionId)}`}
                          className="inline-flex items-center gap-1 truncate font-mono text-xs text-primary hover:underline"
                        >
                          {s.sessionId.slice(0, 24)}…
                          <ArrowRight className="h-3 w-3" />
                        </Link>
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
            </>
          )}
        </CardContent>
      </Card>

      {(() => {
        // Group interventions by variantGroup (which is the struggle type) so
        // the dashboard can show explicit A vs B vs C with their measured win
        // rates. This is the bandit's empirical mean - what's actually driving
        // production variant selection right now.
        const byGroup = new Map<string, typeof intervs>()
        for (const i of intervs) {
          const key = i.variantGroup ?? '(no group)'
          const arr = byGroup.get(key) ?? []
          arr.push(i)
          byGroup.set(key, arr)
        }
        const groups = Array.from(byGroup.entries()).filter(([, arr]) => arr.length > 1)
        if (groups.length === 0) return null
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bandit variant performance</CardTitle>
              <CardDescription>
                Variants with measured impressions for each struggle type. The
                bandit currently exploits the highest-mean variant; cold-start
                falls back to deterministic per-session pick.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {groups.map(([group, variants]) => {
                const sorted = [...variants].sort((a, b) => b.successRate - a.successRate)
                const totalImps = sorted.reduce((s, v) => s + v.impressions, 0)
                const winner = sorted.find((v) => v.impressions >= 30) ?? sorted[0]
                return (
                  <div key={group} className="rounded-md border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div>
                        <Badge variant="secondary" className="text-[11px]">
                          {group}
                        </Badge>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {totalImps} imp{totalImps === 1 ? '' : 's'} ·{' '}
                          {sorted.length} variant{sorted.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      {winner && winner.impressions >= 30 ? (
                        <Badge variant="success" className="text-[10px]">
                          winning
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          exploring
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-2">
                      {sorted.map((v) => {
                        const pct = v.impressions > 0 ? v.successRate : 0
                        const isWinner = v === winner
                        return (
                          <div key={v.id} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex-1 truncate">
                                <span
                                  className={
                                    isWinner ? 'font-medium' : 'text-muted-foreground'
                                  }
                                >
                                  {((v.config as { copy?: string } | null)?.copy ?? v.type).slice(
                                    0,
                                    80,
                                  )}
                                </span>
                              </div>
                              <span className="ml-2 tabular-nums text-muted-foreground">
                                {v.impressions} imp · {v.successes} succ
                              </span>
                              <span className="ml-2 w-12 text-right font-medium tabular-nums">
                                {v.impressions > 0 ? formatPercent(pct) : ' - '}
                              </span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded bg-muted">
                              <div
                                className={
                                  isWinner ? 'h-full bg-emerald-500' : 'h-full bg-zinc-400'
                                }
                                style={{
                                  width: `${Math.max(2, Math.min(100, pct * 100))}%`,
                                }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )
      })()}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Interventions ({intervs.length})</CardTitle>
          <CardDescription>
            What the platform has dispatched here, sorted by success rate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {intervs.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No interventions have fired on this element yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variant</TableHead>
                  <TableHead>Copy</TableHead>
                  <TableHead className="text-right">Impressions</TableHead>
                  <TableHead className="text-right">Success rate</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {intervs.map((i) => {
                  const config = i.config as { copy?: string } | null
                  const copy = config?.copy ?? `(${i.type})`
                  return (
                    <TableRow key={i.id}>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {i.variantGroup ?? i.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[420px] truncate text-sm">{copy}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(i.impressions)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {i.impressions > 0 ? formatPercent(i.successRate) : ' - '}
                      </TableCell>
                      <TableCell className="text-right">
                        {i.enabled ? (
                          <Badge variant="success">enabled</Badge>
                        ) : (
                          <Badge variant="secondary">paused</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {cache.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pre-computed copy ({cache.length})</CardTitle>
            <CardDescription>
              LLM-tailored intervention variants ready for instant runtime dispatch.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Struggle</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Copy</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cache.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {c.struggleType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">v{c.variantIndex}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {c.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[420px] truncate text-sm">{c.copy}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.confidence.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent events ({recentEvents.length})</CardTitle>
          <CardDescription>Latest interactions with this element.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentEvents.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No events yet. As soon as the SDK delivers, they show here.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Session</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentEvents.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {e.eventType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/dashboard/sessions?id=${encodeURIComponent(e.sessionId)}`}
                        className="truncate font-mono text-xs text-primary hover:underline"
                      >
                        {e.sessionId.slice(0, 24)}…
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.route}</TableCell>
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

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-32 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex-1">{value}</div>
    </div>
  )
}
