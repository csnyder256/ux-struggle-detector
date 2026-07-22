import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Activity, Globe, Sparkles } from 'lucide-react'
import { getCurrentOrg } from '@/lib/access'
import { prisma } from '@/lib/db'
import { HttpCrawler } from '@/lib/parsers/crawler'
import { PlaywrightCrawler, looksLikeSpaShell } from '@/lib/parsers/playwright-crawler'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface SearchParams {
  searchParams?: Promise<{
    error?: string
    ok?: string
    elements?: string
    status?: string
    bytes?: string
    /** "headless" when the headless browser path was used. */
    mode?: string
    /** Render time in ms (headless only). */
    renderedFor?: string
  }>
}

export default async function CrawlerOnboardingPage({ searchParams }: SearchParams) {
  const ctx = await getCurrentOrg('/onboarding/crawler')
  const params = (await searchParams) ?? {}

  const platform = await prisma.platformConfig.findUnique({
    where: { orgId: ctx.orgId },
    select: { crawlerTarget: true },
  })

  async function runCrawl(formData: FormData) {
    'use server'
    const c = await getCurrentOrg('/onboarding/crawler')
    const url = String(formData.get('url') ?? '').trim()
    const headlessMode = String(formData.get('mode') ?? 'auto')
    if (!url) {
      redirect('/onboarding/crawler?error=' + encodeURIComponent('URL required.'))
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      redirect('/onboarding/crawler?error=' + encodeURIComponent('Not a valid URL.'))
    }
    if (!['http:', 'https:'].includes(parsed!.protocol)) {
      redirect('/onboarding/crawler?error=' + encodeURIComponent('Only http(s) URLs are supported.'))
    }

    await prisma.platformConfig.upsert({
      where: { orgId: c.orgId },
      create: {
        orgId: c.orgId,
        platformName: parsed!.host,
        platformDescription: '',
        crawlerTarget: url,
      },
      update: { crawlerTarget: url },
    })

    // Strategy:
    //   mode="http"     → always plain fetch
    //   mode="headless" → always Playwright
    //   mode="auto"     → plain fetch first, retry with Playwright if the
    //                     plain HTML looks like an SPA shell
    let result: { uiMap: { elements: unknown[]; routes: unknown[] } & Record<string, unknown>; fetched: { url: string; status: number; bytes: number; renderedFor?: number } }
    let usedHeadless = false
    let renderedFor = 0
    try {
      if (headlessMode === 'headless') {
        const out = await new PlaywrightCrawler().crawlUrl({ orgId: c.orgId, url })
        result = { uiMap: out.uiMap as never, fetched: out.fetched }
        usedHeadless = true
        renderedFor = out.fetched.renderedFor
      } else {
        const httpResult = await new HttpCrawler().crawlUrl({ orgId: c.orgId, url })
        result = { uiMap: httpResult.uiMap as never, fetched: httpResult.fetched }
        // Auto mode: retry with headless if either signal fires:
        //   (a) plain crawl returned < 3 elements (likely SPA), OR
        //   (b) the HTML looks like a known SPA shell shape (#root, module
        //       scripts) regardless of element count - covers SPAs that
        //       render some static markup but hydrate the real UI.
        const shellSignal = httpResult.fetched.html
          ? looksLikeSpaShell(httpResult.fetched.html)
          : false
        if (
          headlessMode === 'auto' &&
          (httpResult.uiMap.elements.length < 3 || shellSignal)
        ) {
          try {
            const headless = await new PlaywrightCrawler().crawlUrl({
              orgId: c.orgId,
              url,
            })
            if (headless.uiMap.elements.length > httpResult.uiMap.elements.length) {
              result = { uiMap: headless.uiMap as never, fetched: headless.fetched }
              usedHeadless = true
              renderedFor = headless.fetched.renderedFor
            }
          } catch {
            // Headless retry is best-effort. Stay with the http result.
          }
        }
      }
    } catch (err) {
      redirect(
        '/onboarding/crawler?error=' +
          encodeURIComponent(`Crawl failed: ${err instanceof Error ? err.message : 'unknown'}`),
      )
    }

    const elements = result!.uiMap.elements as Array<{
      id: string
      filePath: string
      componentName: string | null
      elementType: 'BUTTON' | 'INPUT' | 'SELECT' | 'FORM' | 'LINK' | 'CUSTOM'
      labelRaw: string | null
      labelHash: string
      handlerFunction: string | null
      routeTarget: string | null
    }>
    const routes = result!.uiMap.routes as Array<{
      path: string
      parentPath: string | null
      entryPoints: unknown
    }>

    if (elements.length > 0) {
      const data = elements.map((e) => ({
        id: e.id,
        orgId: c.orgId,
        filePath: e.filePath,
        componentName: e.componentName,
        elementType: e.elementType,
        labelRaw: e.labelRaw,
        labelHash: e.labelHash,
        handlerFunction: e.handlerFunction,
        routeTarget: e.routeTarget,
      }))
      await prisma.uIElement.createMany({ data, skipDuplicates: true })
    }
    if (routes.length > 0) {
      for (const r of routes) {
        await prisma.uIRoute.upsert({
          where: { orgId_path: { orgId: c.orgId, path: r.path } },
          create: {
            orgId: c.orgId,
            path: r.path,
            parentPath: r.parentPath,
            entryPoints: r.entryPoints as never,
          },
          update: { parentPath: r.parentPath, entryPoints: r.entryPoints as never },
        })
      }
    }

    const params = new URLSearchParams({
      ok: '1',
      elements: String(elements.length),
      status: String(result!.fetched.status),
      bytes: String(result!.fetched.bytes),
    })
    if (usedHeadless) {
      params.set('mode', 'headless')
      params.set('renderedFor', String(renderedFor))
    }
    redirect(`/onboarding/crawler?${params.toString()}`)
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
        <div className="container mx-auto max-w-2xl px-6 py-12">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-md border bg-card shadow-sm">
              <Globe className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Crawl a URL</h1>
              <p className="text-sm text-muted-foreground">
                Fetch the rendered HTML and extract every interactive element.
              </p>
            </div>
          </div>

          {params.error ? (
            <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              {decodeURIComponent(params.error)}
            </div>
          ) : null}
          {params.ok ? (
            <div className="mb-6 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
              Crawl complete · status <span className="font-mono">{params.status}</span> ·{' '}
              <span className="font-mono">{params.bytes}</span> bytes ·{' '}
              <span className="font-mono">{params.elements}</span> elements extracted.
              {params.mode === 'headless' ? (
                <>
                  {' '}· rendered in <span className="font-mono">{params.renderedFor}ms</span>{' '}
                  via <Badge variant="secondary" className="ml-1 text-[10px]">headless chromium</Badge>
                </>
              ) : null}
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Single-URL crawl</CardTitle>
              <CardDescription>
                Best for SSR / static pages - Hugo, Jekyll, Eleventy, Astro static, FastHTML, Next
                pages built to HTML, etc. SPA shells return little because the initial HTML is
                empty until JS hydrates; for those, use the SDK on the running app instead.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={runCrawl} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="url">Target URL</Label>
                  <Input
                    id="url"
                    name="url"
                    type="url"
                    placeholder="https://your-site.example.com/page"
                    defaultValue={platform?.crawlerTarget ?? ''}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mode">Crawl strategy</Label>
                  <select
                    id="mode"
                    name="mode"
                    defaultValue="auto"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="auto">
                      Auto - plain fetch, retry with headless if shell looks empty
                    </option>
                    <option value="http">Plain HTTP fetch only (fastest, ~100ms)</option>
                    <option value="headless">
                      Headless chromium (1–5s; required for SPA shells)
                    </option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Headless mode requires the chromium binary - {' '}
                    <code>pnpm exec playwright install chromium</code> if you haven&rsquo;t already.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">Fetch HTML</Badge>
                  <span>·</span>
                  <Badge variant="secondary">Extract buttons / inputs / forms / links</Badge>
                  <span>·</span>
                  <Badge variant="secondary">Save as UIElements</Badge>
                </div>
                <div className="flex justify-end">
                  <Button type="submit">
                    <Sparkles className="h-4 w-4" />
                    Crawl
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <p className="mt-8 text-xs text-muted-foreground">
            Auto mode tries the plain fetch first and only burns chromium time if the shell
            comes back nearly empty (likely an SPA). Use <code>headless</code> explicitly if
            you know the page is dynamic.
          </p>

          <div className="mt-6 flex gap-3">
            <Link href="/onboarding/direct">
              <Button variant="outline">Or use Direct setup</Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="ghost">Dashboard</Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
