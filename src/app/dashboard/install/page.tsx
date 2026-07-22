import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { Check, Circle, Code2, ExternalLink, Send, Sparkles } from 'lucide-react'
import { getCurrentOrg } from '@/lib/access'
import { prisma } from '@/lib/db'
import { EVENT_SCHEMA_VERSION } from '@/lib/types/events'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SdkSnippet } from '@/components/onboarding/SdkSnippet'
import { formatNumber, formatRelativeTime } from '@/lib/utils'

interface SearchParams {
  searchParams?: Promise<{ tested?: string; testErr?: string }>
}

export default async function DashboardInstall({ searchParams }: SearchParams) {
  const ctx = await getCurrentOrg('/dashboard/install')
  const baseUrl = process.env.AUTH_URL || 'http://localhost:3000'
  const params = (await searchParams) ?? {}

  const [
    eventsCount,
    lastEvent,
    config,
    deepKey,
    elementCount,
    enrichedCount,
    interventionCount,
    cachedCount,
  ] = await Promise.all([
    prisma.userEvent.count({ where: { orgId: ctx.orgId } }),
    prisma.userEvent.findFirst({
      where: { orgId: ctx.orgId },
      orderBy: { ts: 'desc' },
      select: { ts: true },
    }),
    prisma.platformConfig.findUnique({
      where: { orgId: ctx.orgId },
      select: {
        platformName: true,
        platformDescription: true,
        safeMode: true,
        samplingConfig: true,
      } as never,
    }) as Promise<
      | {
          platformName: string
          platformDescription: string
          safeMode: boolean
          samplingConfig?: unknown
        }
      | null
    >,
    prisma.providerKey.findFirst({ where: { orgId: ctx.orgId, kind: 'DEEP' } }),
    prisma.uIElement.count({ where: { orgId: ctx.orgId } }),
    prisma.uIElement.count({
      where: { orgId: ctx.orgId, semantics: { some: {} } },
    }),
    prisma.intervention.count({ where: { orgId: ctx.orgId } }),
    prisma.interventionCache.count({ where: { orgId: ctx.orgId } }),
  ])

  const samplingRaw = config?.samplingConfig
  const samplingConfig =
    samplingRaw && typeof samplingRaw === 'object' && !Array.isArray(samplingRaw)
      ? (samplingRaw as { default?: number; byType?: Record<string, number> })
      : undefined

  // Compute the setup checklist - what's left before the customer is fully
  // wired? Each step has a status (done | pending) + a navigable action.
  const checklist: Array<{
    label: string
    detail: string
    done: boolean
    action?: { href: string; label: string }
  }> = [
    {
      label: 'Platform info filled',
      detail: 'Name + description used as LLM context for enrichment.',
      done: Boolean(config?.platformName && config.platformDescription),
      action: !config?.platformName
        ? { href: '/dashboard/settings', label: 'Add platform info' }
        : undefined,
    },
    {
      label: 'DEEP API key configured',
      detail: 'Required for static-map enrichment + intervention pre-computation.',
      done: Boolean(deepKey),
      action: !deepKey ? { href: '/dashboard/settings', label: 'Add API key' } : undefined,
    },
    {
      label: 'UI elements mapped',
      detail: `${elementCount} element${elementCount === 1 ? '' : 's'} mapped from your repo.`,
      done: elementCount > 0,
      action: elementCount === 0 ? { href: '/dashboard/repos', label: 'Map a repo' } : undefined,
    },
    {
      label: 'Elements enriched',
      detail: `${enrichedCount}/${elementCount} elements have semantic names + intent.`,
      done: elementCount > 0 && enrichedCount === elementCount,
      action:
        elementCount > 0 && enrichedCount < elementCount
          ? { href: '/dashboard/elements', label: 'Run enrichment' }
          : undefined,
    },
    {
      label: 'SDK installed',
      detail: lastEvent
        ? `Last event ${formatRelativeTime(lastEvent.ts)}`
        : 'Drop the script tag below into your app.',
      done: lastEvent
        ? Date.now() - lastEvent.ts.getTime() < 24 * 60 * 60 * 1000
        : false,
    },
    {
      label: 'Pre-computed interventions',
      detail: `${cachedCount} cached intervention variants ready.`,
      done: cachedCount > 0,
      action:
        cachedCount === 0 && enrichedCount > 0
          ? { href: '/dashboard/interventions', label: 'Pre-compute' }
          : undefined,
    },
    {
      label: 'Active interventions firing',
      detail: `${interventionCount} intervention rows recorded.`,
      done: interventionCount > 0,
    },
    {
      label: 'Active mode (safe mode off)',
      detail: 'When ON, events still flow but interventions never render.',
      done: config?.safeMode === false,
      action:
        config?.safeMode !== false
          ? { href: '/dashboard/settings', label: 'Toggle safe mode' }
          : undefined,
    },
  ]
  const completed = checklist.filter((c) => c.done).length

  async function pingIngest() {
    'use server'
    const c = await getCurrentOrg('/dashboard/install')
    const url = `${process.env.AUTH_URL || 'http://localhost:3000'}/api/events`
    try {
      const sessionId = `dash_test_${Date.now()}`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Org-Id': c.orgId,
        },
        body: JSON.stringify({
          schemaVersion: EVENT_SCHEMA_VERSION,
          clockOffsetMs: 0,
          events: [
            {
              schemaVersion: EVENT_SCHEMA_VERSION,
              idempotencyKey: `${sessionId}_initial`,
              sessionId,
              userIdHash: null,
              elementId: null,
              route: '/dashboard/install',
              eventType: 'NAVIGATION',
              ts: new Date().toISOString(),
              meta: { trigger: 'test' },
            },
            {
              schemaVersion: EVENT_SCHEMA_VERSION,
              idempotencyKey: `${sessionId}_click`,
              sessionId,
              userIdHash: null,
              elementId: null,
              route: '/dashboard/install',
              eventType: 'CLICK',
              ts: new Date().toISOString(),
              meta: { synthetic: true },
            },
          ],
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        redirect(
          '/dashboard/install?testErr=' +
            encodeURIComponent(`HTTP ${res.status}: ${text.slice(0, 200)}`),
        )
      }
      const json = (await res.json()) as { accepted: number; interventions?: unknown[] }
      revalidatePath('/dashboard/install')
      redirect(
        `/dashboard/install?tested=${json.accepted ?? 0}_${json.interventions?.length ?? 0}`,
      )
    } catch (err) {
      redirect(
        '/dashboard/install?testErr=' +
          encodeURIComponent((err as Error).message ?? 'fetch failed'),
      )
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SDK install</h1>
        <p className="text-sm text-muted-foreground">
          One script tag. Drop it just before <code>&lt;/body&gt;</code> in your app, or in your
          root layout for SPA frameworks.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Events received" value={formatNumber(eventsCount)} />
        <StatCard
          label="Last event"
          value={lastEvent ? formatRelativeTime(lastEvent.ts) : ' - '}
        />
        <StatCard label="Org id" value={ctx.orgId} mono />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>
              Setup checklist · {completed}/{checklist.length}
            </CardTitle>
            <Badge variant={completed === checklist.length ? 'success' : 'secondary'}>
              {completed === checklist.length ? 'Fully wired' : `${checklist.length - completed} pending`}
            </Badge>
          </div>
          <CardDescription>
            What&rsquo;s left before this org is fully plug-and-play. Click an action to jump.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {checklist.map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                {item.done ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <div
                    className={
                      item.done ? 'text-sm font-medium' : 'text-sm font-medium text-muted-foreground'
                    }
                  >
                    {item.label}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{item.detail}</div>
                </div>
              </div>
              {item.action ? (
                <Link href={item.action.href}>
                  <Button variant="outline" size="sm">
                    {item.action.label}
                  </Button>
                </Link>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      {params.tested ? (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          {(() => {
            const [accepted, interventions] = params.tested.split('_')
            return `Round-trip test passed - ${accepted} events accepted, ${interventions} interventions dispatched.`
          })()}
        </div>
      ) : null}
      {params.testErr ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Round-trip test failed: {decodeURIComponent(params.testErr)}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Code2 className="h-5 w-5" />
            <CardTitle>Script tag (auto-init)</CardTitle>
            <Badge variant="success" className="ml-auto">
              ~9 KB gzipped
            </Badge>
          </div>
          <CardDescription>
            Paste this into your app. Your <code>orgId</code> is pre-filled - keep it as-is and
            the SDK will stream events into this dashboard automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SdkSnippet baseUrl={baseUrl} orgId={ctx.orgId} samplingConfig={samplingConfig} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custom event tagging (optional)</CardTitle>
          <CardDescription>
            After the script-tag init, the global <code>ClarusHeal</code> exposes a few JS APIs
            for tagging key business events and identifying signed-in users. Both are optional - 
            the automatic UI events still flow without them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md border bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-100">
            <code>{`// Tag a key business event - appears as CUSTOM events in the dashboard
ClarusHeal.track('checkout_completed', { plan: 'pro', amount_cents: 4900 })

// Associate the current session with a user. The id is SHA-256-hashed
// in the browser - we never persist plaintext user identifiers.
ClarusHeal.identify('user_abc123')

// Manually trigger a validation-error event the detector can react to
document.dispatchEvent(new CustomEvent('clarus-heal:validation', {
  detail: { kind: 'format', field: 'email' }
}))`}</code>
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            <CardTitle>Try it now</CardTitle>
          </div>
          <CardDescription>
            Two ways to verify the pipeline before integrating: ping the ingest endpoint
            server-side, or open the demo page that runs the SDK against synthetic buttons.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <form action={pingIngest}>
            <Button type="submit">
              <Send className="h-4 w-4" />
              Ping /api/events
            </Button>
          </form>
          <Link href="/demo/" target="_blank">
            <Button variant="outline">
              Open demo
              <ExternalLink className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/dashboard/friction">
            <Button variant="ghost">Friction dashboard</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={mono ? 'truncate font-mono text-sm' : 'text-2xl font-semibold tabular-nums'}>
          {value}
        </div>
      </CardContent>
    </Card>
  )
}
