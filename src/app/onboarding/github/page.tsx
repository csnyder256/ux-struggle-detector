import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { Activity, AlertCircle, Check, Github, RefreshCcw, Settings } from 'lucide-react'
import { getCurrentOrg } from '@/lib/access'
import { prisma } from '@/lib/db'
import { isGitHubAppConfigured } from '@/lib/github/app'
import { mapGithubRepo } from '@/lib/github/map-repo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const ERROR_COPY: Record<string, string> = {
  not_configured:
    "GitHub App isn't configured on this server. Ask your admin to register the app and set the GITHUB_APP_* env vars (see GITHUB_SETUP.md).",
  no_id: 'GitHub did not return an installation_id on the callback. Try again from the start.',
  bad_id: 'The installation_id GitHub sent looked invalid. Try again from the start.',
  auth_failed:
    'We saved your installation but could not authenticate as the app. Check your GITHUB_APP_PRIVATE_KEY env var.',
}

export default async function GitHubOnboardingPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; status?: string; mapped?: string; mapErr?: string }>
}) {
  const ctx = await getCurrentOrg('/onboarding/github')
  const params = (await searchParams) ?? {}

  const configured = isGitHubAppConfigured()
  const errorKey = params.error
  const showInstalledBanner = params.status === 'installed'

  async function runMapping(formData: FormData) {
    'use server'
    const c = await getCurrentOrg('/onboarding/github')
    const installationId = Number(formData.get('installationId') ?? '0')
    const fullName = String(formData.get('fullName') ?? '')
    const defaultBranch = String(formData.get('defaultBranch') ?? '') || null
    if (!installationId || !fullName) {
      redirect('/onboarding/github?mapErr=' + encodeURIComponent('Missing installation or repo.'))
    }
    try {
      await prisma.gitHubRepo.updateMany({
        where: { orgId: c.orgId, fullName },
        data: { mappingStatus: 'IN_PROGRESS', mappingError: null },
      })
      const result = await mapGithubRepo({
        orgId: c.orgId,
        installationId,
        fullName,
        defaultBranch,
      })
      revalidatePath('/onboarding/github')
      if (!result.ok) {
        redirect('/onboarding/github?mapErr=' + encodeURIComponent(result.error ?? 'Mapping failed'))
      }
      redirect(
        `/onboarding/github?mapped=${encodeURIComponent(fullName)}__${result.elements ?? 0}_${result.routes ?? 0}_${result.filesFetched}`,
      )
    } catch (err) {
      redirect('/onboarding/github?mapErr=' + encodeURIComponent((err as Error).message))
    }
  }

  const installations = await prisma.gitHubInstallation.findMany({
    where: { orgId: ctx.orgId, removedAt: null },
    include: {
      repos: {
        orderBy: { fullName: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background to-muted/30">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Activity className="h-5 w-5" />
            <span>Clarus Heal</span>
          </Link>
          <span className="text-sm text-muted-foreground">
            {ctx.userEmail ?? 'Open access · demo workspace'}
          </span>
        </div>
      </header>

      <main className="flex-1">
        <div className="container mx-auto max-w-3xl px-6 py-12">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border bg-card shadow-sm">
              <Github className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Connect GitHub</h1>
              <p className="text-sm text-muted-foreground">
                We&rsquo;ll read your repo and build the UI map automatically.
              </p>
            </div>
          </div>

          {errorKey && ERROR_COPY[errorKey] ? (
            <div className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">Something went wrong</p>
                <p className="mt-1 text-sm text-muted-foreground">{ERROR_COPY[errorKey]}</p>
              </div>
            </div>
          ) : null}

          {showInstalledBanner ? (
            <div className="mb-6 flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div>
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  GitHub App installed
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pick a repo below to start mapping.
                </p>
              </div>
            </div>
          ) : null}

          {params.mapErr ? (
            <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              Mapping failed: {decodeURIComponent(params.mapErr)}
            </div>
          ) : null}
          {params.mapped ? (
            <div className="mb-6 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
              {(() => {
                const [name, rest] = decodeURIComponent(params.mapped).split('__')
                const [els, routes, files] = (rest ?? '0_0_0').split('_')
                return `Mapped ${name} - fetched ${files} files, extracted ${els} elements, ${routes} routes.`
              })()}
            </div>
          ) : null}

          {!configured ? (
            <SetupRequiredCard />
          ) : installations.length === 0 ? (
            <NotInstalledCard />
          ) : (
            <InstallationsList installations={installations} mapAction={runMapping} />
          )}

          <div className="mt-10 text-center text-sm text-muted-foreground">
            Prefer to skip GitHub for now?{' '}
            <Link href="/onboarding/direct" className="font-medium underline">
              Use Direct setup instead
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}

function SetupRequiredCard() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          <CardTitle>Server setup required</CardTitle>
        </div>
        <CardDescription>
          The GitHub App credentials aren&rsquo;t configured. This is a one-time admin step.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Whoever set up this Clarus Heal deployment needs to register a GitHub App and add its
          credentials to the server&rsquo;s environment variables. The full walk-through is in{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">GITHUB_SETUP.md</code>{' '}
          at the project root.
        </p>
        <div className="rounded-md bg-muted/50 p-4 text-sm">
          <p className="font-medium text-foreground">Required env vars</p>
          <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
            <li>GITHUB_APP_NAME</li>
            <li>GITHUB_APP_ID</li>
            <li>GITHUB_APP_CLIENT_ID</li>
            <li>GITHUB_APP_CLIENT_SECRET</li>
            <li>GITHUB_APP_PRIVATE_KEY</li>
            <li>GITHUB_APP_WEBHOOK_SECRET</li>
          </ul>
        </div>
        <p className="text-muted-foreground">
          Once those are set and the server restarts, this page becomes functional.
        </p>
      </CardContent>
    </Card>
  )
}

function NotInstalledCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Install the GitHub App</CardTitle>
        <CardDescription>
          You&rsquo;ll be redirected to GitHub to pick which repositories to grant access to. We
          only request <span className="font-medium text-foreground">read access</span> to code +
          metadata.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/api/github/install">
          <Button size="lg" className="w-full sm:w-auto">
            <Github className="h-4 w-4" />
            Install on GitHub
          </Button>
        </Link>
        <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>Read access only - we never write to your repo.</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>Pick specific repos. We can&rsquo;t see anything you don&rsquo;t grant.</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>Revoke any time from your GitHub settings.</span>
          </li>
        </ul>
      </CardContent>
    </Card>
  )
}

interface InstallationProps {
  installations: Array<{
    id: string
    installationId: number
    accountLogin: string
    accountType: string
    repos: Array<{
      id: string
      fullName: string
      defaultBranch: string | null
      selected: boolean
      mappingStatus: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED'
      lastMappedAt: Date | null
    }>
  }>
  mapAction: (formData: FormData) => Promise<void>
}

function InstallationsList({ installations, mapAction }: InstallationProps) {
  return (
    <div className="space-y-6">
      {installations.map((inst) => (
        <Card key={inst.id}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg">
                  {inst.accountLogin}{' '}
                  <Badge variant="secondary" className="ml-1 align-middle text-[10px]">
                    {inst.accountType}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {inst.repos.length} repo{inst.repos.length === 1 ? '' : 's'} accessible
                </CardDescription>
              </div>
              <Link href="/api/github/install">
                <Button variant="outline" size="sm">
                  <RefreshCcw className="h-3 w-3" />
                  Add more
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {inst.repos.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No repos accessible yet. Click &ldquo;Add more&rdquo; to grant access.
              </div>
            ) : (
              <ul className="divide-y rounded-md border">
                {inst.repos.map((repo) => (
                  <li key={repo.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{repo.fullName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {repo.defaultBranch ? `default branch: ${repo.defaultBranch}` : 'branch unknown'}
                        {repo.lastMappedAt
                          ? ` · last mapped ${repo.lastMappedAt.toISOString().slice(0, 10)}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <MappingBadge status={repo.mappingStatus} />
                      <form action={mapAction}>
                        <input type="hidden" name="installationId" value={inst.installationId} />
                        <input type="hidden" name="fullName" value={repo.fullName} />
                        <input
                          type="hidden"
                          name="defaultBranch"
                          value={repo.defaultBranch ?? ''}
                        />
                        <Button size="sm" variant="outline" type="submit">
                          Map repo
                        </Button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              Clicking &ldquo;Map repo&rdquo; fetches every parseable file via the GitHub tree+blob
              API, runs the framework auto-detector + parser, and persists UIElements + UIRoutes.
              For monorepos, only the first {1500} parseable files are fetched.
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function MappingBadge({
  status,
}: {
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED'
}) {
  if (status === 'SUCCEEDED') return <Badge variant="success">Mapped</Badge>
  if (status === 'IN_PROGRESS') return <Badge variant="warning">Mapping…</Badge>
  if (status === 'FAILED') return <Badge variant="destructive">Failed</Badge>
  return <Badge variant="outline">Not yet mapped</Badge>
}
