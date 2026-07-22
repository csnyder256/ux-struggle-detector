import { redirect } from 'next/navigation'
import { FolderTree, GitBranch, Sparkles } from 'lucide-react'
import { getCurrentOrg } from '@/lib/access'
import { prisma } from '@/lib/db'
import { mapAndPersist } from '@/lib/parsers/persist'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatRelativeTime } from '@/lib/utils'

interface SearchParams {
  searchParams?: Promise<{ error?: string; ok?: string; framework?: string; elements?: string; routes?: string }>
}

export default async function DashboardRepos({ searchParams }: SearchParams) {
  const ctx = await getCurrentOrg('/dashboard/repos')
  const params = (await searchParams) ?? {}

  const platform = await prisma.platformConfig.findUnique({ where: { orgId: ctx.orgId } })

  const detected = await prisma.detectedFramework.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { detectedAt: 'desc' },
    take: 20,
    select: { id: true, frameworkId: true, confidence: true, detectedAt: true },
  })

  const elementCount = await prisma.uIElement.count({ where: { orgId: ctx.orgId } })
  const routeCount = await prisma.uIRoute.count({ where: { orgId: ctx.orgId } })

  async function runMapping(formData: FormData) {
    'use server'
    const c = await getCurrentOrg('/dashboard/repos')
    const sourceRaw = String(formData.get('source') ?? '').trim()
    if (!sourceRaw) {
      redirect('/dashboard/repos?error=' + encodeURIComponent('Path required.'))
    }
    const result = await mapAndPersist(c.orgId, sourceRaw)
    if (!result.ok) {
      redirect('/dashboard/repos?error=' + encodeURIComponent(result.error ?? 'Mapping failed.'))
    }
    redirect(
      '/dashboard/repos?ok=1&framework=' +
        encodeURIComponent(result.frameworkName ?? '') +
        '&elements=' +
        (result.elements ?? 0) +
        '&routes=' +
        (result.routes ?? 0),
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Repos</h1>
        <p className="text-sm text-muted-foreground">
          Map a directory or git URL. We auto-detect the framework and populate the element /
          route inventory.
        </p>
      </div>

      {params.error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {decodeURIComponent(params.error)}
        </div>
      ) : null}

      {params.ok ? (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          Mapped <span className="font-mono">{params.framework}</span> ·{' '}
          <span className="font-mono">{params.elements}</span> elements ·{' '}
          <span className="font-mono">{params.routes}</span> routes.
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FolderTree className="h-5 w-5" />
            <CardTitle>Map a path</CardTitle>
          </div>
          <CardDescription>
            Absolute path to a directory the server can read. For git URLs the GitHub App handles
            cloning + webhooks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={runMapping} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="source">Path or git URL</Label>
              <Input
                id="source"
                name="source"
                placeholder="C:\path\to\project   or   https://github.com/owner/repo"
                defaultValue={platform?.repoUrl ?? ''}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit">
                <Sparkles className="h-4 w-4" />
                Run mapping
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Elements mapped" value={elementCount.toLocaleString()} />
        <StatCard label="Routes mapped" value={routeCount.toLocaleString()} />
        <StatCard label="Frameworks detected" value={detected.length.toString()} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            <CardTitle>Detected frameworks</CardTitle>
          </div>
          <CardDescription>
            Most recent detection runs. Confidence is computed from how many independent signals
            (deps, config files, file extensions) matched.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {detected.length === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
              Run a mapping above to see detection results here.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Framework</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead className="text-right">Detected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detected.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-sm">{d.frameworkId}</TableCell>
                    <TableCell>
                      <Badge variant={d.confidence > 0.7 ? 'success' : d.confidence > 0.5 ? 'default' : 'secondary'}>
                        {Math.round(d.confidence * 100)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatRelativeTime(d.detectedAt)}
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
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  )
}
