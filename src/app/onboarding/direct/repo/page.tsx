import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Activity, FolderTree, GitBranch, Sparkles } from 'lucide-react'
import { getCurrentOrg } from '@/lib/access'
import { prisma } from '@/lib/db'
import { mapAndPersist } from '@/lib/parsers/persist'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { WizardSteps } from '@/components/onboarding/WizardSteps'

interface SearchParams {
  searchParams?: Promise<{
    error?: string
    detected?: string
    elements?: string
    routes?: string
    framework?: string
  }>
}

export default async function OnboardingStep4({ searchParams }: SearchParams) {
  const ctx = await getCurrentOrg('/onboarding/direct/repo')
  const params = (await searchParams) ?? {}

  const platform = await prisma.platformConfig.findUnique({
    where: { orgId: ctx.orgId },
  })
  if (!platform) redirect('/onboarding/direct')

  // Last-mapped count, for the "you've already mapped" hint.
  const elementCount = await prisma.uIElement.count({ where: { orgId: ctx.orgId } })

  async function runMapping(formData: FormData) {
    'use server'
    const c = await getCurrentOrg('/onboarding/direct/repo')
    const sourceRaw = String(formData.get('source') ?? '').trim()
    if (!sourceRaw) {
      redirect('/onboarding/direct/repo?error=' + encodeURIComponent('Path or URL required.'))
    }
    const result = await mapAndPersist(c.orgId, sourceRaw)
    if (!result.ok) {
      redirect('/onboarding/direct/repo?error=' + encodeURIComponent(result.error ?? 'Mapping failed.'))
    }
    redirect(
      '/onboarding/direct/repo?detected=1&framework=' +
        encodeURIComponent(result.frameworkName ?? '') +
        '&elements=' +
        (result.elements ?? 0) +
        '&routes=' +
        (result.routes ?? 0),
    )
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="container mx-auto flex h-14 max-w-6xl items-center px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Activity className="h-5 w-5" />
            <span>Clarus Heal</span>
          </Link>
        </div>
      </header>
      <main className="flex-1">
        <div className="container mx-auto max-w-3xl px-6 py-12">
          <WizardSteps current={4} />
          <h1 className="text-3xl font-semibold tracking-tight">Map your repo (optional)</h1>
          <p className="mt-2 text-muted-foreground">
            Point us at a directory on this server (or a git URL - saved for the worker). We
            auto-detect the framework, parse the source, and populate the element + route
            inventory the dashboard reads from.
          </p>

          {params.error ? (
            <div className="mt-6 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              {decodeURIComponent(params.error)}
            </div>
          ) : null}

          {params.detected ? (
            <div className="mt-6 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
              <span className="font-medium">Mapping complete.</span> Detected{' '}
              <span className="font-mono">{params.framework}</span> ·{' '}
              <span className="font-mono">{params.elements}</span> elements ·{' '}
              <span className="font-mono">{params.routes}</span> routes.
            </div>
          ) : null}

          <Card className="mt-8">
            <CardHeader>
              <div className="flex items-center gap-2">
                <FolderTree className="h-5 w-5" />
                <CardTitle>Local path</CardTitle>
              </div>
              <CardDescription>
                Absolute path to a directory the Next.js server can read. Works great in dev
 - paste the path to any project on your machine.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={runMapping} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="source">Path or git URL</Label>
                  <Input
                    id="source"
                    name="source"
                    placeholder="C:\path\to\project   or   /Users/you/project   or   https://github.com/owner/repo"
                    defaultValue={platform.repoUrl ?? ''}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">Detect framework</Badge>
                  <span>·</span>
                  <Badge variant="secondary">Parse elements</Badge>
                  <span>·</span>
                  <Badge variant="secondary">Build route map</Badge>
                  {elementCount > 0 ? (
                    <>
                      <span className="ml-auto" />
                      <Badge variant="success">{elementCount} elements already mapped</Badge>
                    </>
                  ) : null}
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

          <Card className="mt-6">
            <CardHeader>
              <div className="flex items-center gap-2">
                <GitBranch className="h-5 w-5" />
                <CardTitle>Or use the GitHub App</CardTitle>
              </div>
              <CardDescription>
                For production, the GitHub App handles cloning, webhook-driven re-mapping, and
                fine-grained permissions. Requires a one-time admin step (see{' '}
                <code className="font-mono">GITHUB_SETUP.md</code>).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/onboarding/github">
                <Button variant="outline">Open GitHub flow</Button>
              </Link>
            </CardContent>
          </Card>

          <div className="mt-8 flex justify-between gap-3">
            <Link href="/onboarding/direct/sdk">
              <Button variant="outline">Back</Button>
            </Link>
            <div className="flex gap-3">
              <Link href="/onboarding/direct/done">
                <Button variant="ghost">Skip</Button>
              </Link>
              <Link href="/onboarding/direct/done">
                <Button>Continue</Button>
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
