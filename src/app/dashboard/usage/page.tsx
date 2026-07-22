import { getCurrentOrg } from '@/lib/access'
import { currentMonthMAU, recentUsage } from '@/lib/usage/track'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatNumber } from '@/lib/utils'
import { EmptyStateBanner } from '@/components/dashboard/EmptyStateBanner'

export default async function UsagePage() {
  const ctx = await getCurrentOrg('/dashboard/usage')
  const [months, mauCount] = await Promise.all([
    recentUsage(ctx.orgId, 6),
    currentMonthMAU(ctx.orgId),
  ])
  const current = months.find(
    (m) =>
      m.month.getUTCFullYear() === new Date().getUTCFullYear() &&
      m.month.getUTCMonth() === new Date().getUTCMonth(),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="text-sm text-muted-foreground">
          Events ingested, deep + fast LLM tokens, and interventions shown - broken out by month
          so you can see costs growing before they surprise you.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="MAU this month" value={formatNumber(mauCount)} />
        <StatCard label="Events this month" value={current ? formatNumber(current.events) : '0'} />
        <StatCard
          label="Interventions shown"
          value={current ? formatNumber(current.interventionsShown) : '0'}
        />
        <StatCard
          label="Deep tokens"
          value={current ? formatNumber(Number(current.deepTokens)) : '0'}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        MAU is computed from distinct user-id hashes seen this month (via the SDK&rsquo;s
        <code className="mx-1">ClarusHeal.identify(userId)</code>
        call). Token columns reflect LLM usage from enrichment + precompute workers.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Monthly history</CardTitle>
          <CardDescription>Last 6 months. Token columns separate deep (mapping-time) from fast (runtime).</CardDescription>
        </CardHeader>
        <CardContent>
          {months.length === 0 ? (
            <EmptyStateBanner />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Events</TableHead>
                  <TableHead className="text-right">MAU</TableHead>
                  <TableHead className="text-right">Interventions shown</TableHead>
                  <TableHead className="text-right">Deep tokens</TableHead>
                  <TableHead className="text-right">Fast tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">
                      {m.month.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(m.events)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(m.mau)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(m.interventionsShown)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(Number(m.deepTokens))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(Number(m.fastTokens))}
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  )
}
