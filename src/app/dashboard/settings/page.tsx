import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { Sparkles, Trash2, Key as KeyIcon } from 'lucide-react'
import { getCurrentOrg } from '@/lib/access'
import { prisma } from '@/lib/db'
import { seedDemoData, clearDemoData } from '@/lib/seed/demo'
import {
  createIngestKey,
  ingestKeyRequired,
  listIngestKeys,
  revokeIngestKey,
} from '@/lib/auth/ingest'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { KeyManager } from '@/components/dashboard/KeyManager'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime } from '@/lib/utils'
import { SamplingSliders, type SamplingConfig } from '@/components/dashboard/SamplingSliders'

interface SearchParams {
  searchParams?: Promise<{ seeded?: string; cleared?: string; freshKey?: string }>
}

export default async function SettingsPage({ searchParams }: SearchParams) {
  const ctx = await getCurrentOrg('/dashboard/settings')
  const orgId = ctx.orgId
  const params = (await searchParams) ?? {}

  const [config, keys, ingestKeys] = await Promise.all([
    prisma.platformConfig.findUnique({ where: { orgId } }),
    prisma.providerKey.findMany({
      where: { orgId },
      select: { kind: true, provider: true, lastFour: true, rotatedAt: true, createdAt: true },
    }),
    listIngestKeys(orgId),
  ])
  const requireKey = ingestKeyRequired()

  const denyRaw = (config as { routeDenylist?: unknown } | null | undefined)?.routeDenylist
  const routeDenylist: string[] = Array.isArray(denyRaw)
    ? (denyRaw as unknown[]).filter((r): r is string => typeof r === 'string')
    : []
  const samplingRaw = (config as { samplingConfig?: unknown } | null | undefined)?.samplingConfig
  const samplingConfig: SamplingConfig =
    samplingRaw && typeof samplingRaw === 'object' && !Array.isArray(samplingRaw)
      ? (samplingRaw as SamplingConfig)
      : {}

  const deep = keys.find((k) => k.kind === 'DEEP') ?? null
  const fast = keys.find((k) => k.kind === 'FAST') ?? null

  async function toggleSafeMode(formData: FormData) {
    'use server'
    const c = await getCurrentOrg('/dashboard/settings')
    const enabled = formData.get('safeMode') === 'on'
    await prisma.platformConfig.update({
      where: { orgId: c.orgId },
      data: { safeMode: enabled, safeModeUntil: enabled ? null : new Date() },
    })
    revalidatePath('/dashboard/settings')
  }

  async function saveSampling(formData: FormData) {
    'use server'
    const c = await getCurrentOrg('/dashboard/settings')
    const raw = String(formData.get('samplingJson') ?? '{}')
    let parsed: SamplingConfig = {}
    try {
      const obj = JSON.parse(raw)
      if (obj && typeof obj === 'object') parsed = obj as SamplingConfig
    } catch {
      // ignore - keep current config
    }
    // Clamp values to [0, 1] so a malicious form post can't poison.
    const clamp = (n: unknown): number => {
      if (typeof n !== 'number' || !Number.isFinite(n)) return 1
      return Math.max(0, Math.min(1, n))
    }
    const cleaned: SamplingConfig = {}
    if (typeof parsed.default === 'number') cleaned.default = clamp(parsed.default)
    if (parsed.byType && typeof parsed.byType === 'object') {
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(parsed.byType)) {
        if (typeof v === 'number') out[k] = clamp(v)
      }
      if (Object.keys(out).length > 0) cleaned.byType = out as SamplingConfig['byType']
    }
    await prisma.platformConfig.update({
      where: { orgId: c.orgId },
      data: { samplingConfig: cleaned as never },
    })
    revalidatePath('/dashboard/settings')
    revalidatePath('/dashboard/install')
  }

  async function saveDenylist(formData: FormData) {
    'use server'
    const c = await getCurrentOrg('/dashboard/settings')
    const raw = String(formData.get('denylist') ?? '')
    const list = raw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 100)
    await prisma.platformConfig.update({
      where: { orgId: c.orgId },
      data: { routeDenylist: list } as never,
    })
    revalidatePath('/dashboard/settings')
  }

  async function runSeed() {
    'use server'
    const c = await getCurrentOrg('/dashboard/settings')
    const result = await seedDemoData(c.orgId)
    revalidatePath('/dashboard')
    redirect(
      `/dashboard/settings?seeded=${result.created.events}_${result.created.struggles}_${result.created.interventions}`,
    )
  }

  async function runClear() {
    'use server'
    const c = await getCurrentOrg('/dashboard/settings')
    const result = await clearDemoData(c.orgId)
    revalidatePath('/dashboard')
    redirect(`/dashboard/settings?cleared=${result.deleted}`)
  }

  async function createIngestKeyAction(formData: FormData) {
    'use server'
    const c = await getCurrentOrg('/dashboard/settings')
    const label = String(formData.get('label') ?? '').trim() || undefined
    const k = await createIngestKey(c.orgId, label)
    revalidatePath('/dashboard/settings')
    redirect('/dashboard/settings?freshKey=' + encodeURIComponent(k.plaintext))
  }

  async function revokeIngestKeyAction(formData: FormData) {
    'use server'
    const c = await getCurrentOrg('/dashboard/settings')
    const id = String(formData.get('id') ?? '')
    if (id) await revokeIngestKey(id, c.orgId)
    revalidatePath('/dashboard/settings')
  }

  async function savePlatformMeta(formData: FormData) {
    'use server'
    const c = await getCurrentOrg('/dashboard/settings')
    const platformName = String(formData.get('platformName') ?? '').trim()
    const platformDescription = String(formData.get('platformDescription') ?? '').trim()
    if (!platformName || !platformDescription) return
    await prisma.platformConfig.update({
      where: { orgId: c.orgId },
      data: { platformName, platformDescription },
    })
    revalidatePath('/dashboard/settings')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage API keys, safety gates, and platform metadata.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            Stored encrypted at rest with AES-GCM. Plaintext keys never leave the server, never
            re-render to the browser, and never log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KeyManager deep={deep} fast={fast} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ingest keys</CardTitle>
          <CardDescription>
            Bearer tokens the SDK passes on every batch. Stored hashed - plaintext is shown ONCE
            on creation. Pass into the SDK init as <code>{'{ ingestKey: "ck_..." }'}</code>.
            {requireKey ? (
              <span className="ml-1 font-medium">REQUIRE_INGEST_KEY is enabled - events without a valid key are rejected.</span>
            ) : (
              <span className="ml-1">Open dev mode - X-Org-Id alone still works.</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {params.freshKey ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-300">
                New key - copy now, you won&rsquo;t see it again.
              </p>
              <code className="block break-all rounded bg-background px-2 py-1 font-mono text-xs">
                {params.freshKey}
              </code>
            </div>
          ) : null}
          {ingestKeys.length === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              No ingest keys yet. Create one to switch the SDK to authenticated mode.
            </div>
          ) : (
            <div className="space-y-2">
              {ingestKeys.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-xs">{k.prefix}…</code>
                      {k.label ? <span className="text-muted-foreground"> - {k.label}</span> : null}
                      {k.revokedAt ? (
                        <Badge variant="destructive" className="text-[10px]">
                          revoked
                        </Badge>
                      ) : (
                        <Badge variant="success" className="text-[10px]">
                          active
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Created {formatRelativeTime(k.createdAt)}
                      {k.lastUsedAt ? ` · last used ${formatRelativeTime(k.lastUsedAt)}` : ' · never used'}
                    </div>
                  </div>
                  {!k.revokedAt ? (
                    <form action={revokeIngestKeyAction}>
                      <input type="hidden" name="id" value={k.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Revoke
                      </Button>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          <form action={createIngestKeyAction} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px] space-y-1">
              <Label htmlFor="label" className="text-xs">
                Label (optional)
              </Label>
              <input
                id="label"
                name="label"
                placeholder="production / staging / local"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <Button type="submit" size="sm">
              <KeyIcon className="h-4 w-4" />
              Create key
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Safety</CardTitle>
          <CardDescription>
            Safe mode is on by default for the first 7 days post-install. The SDK still collects
            events; no interventions render until you flip the switch.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={toggleSafeMode} className="space-y-4">
            <div className="flex items-center justify-between rounded-md border p-4">
              <div>
                <Label htmlFor="safeMode" className="text-base">
                  Safe mode (observe-only)
                </Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  When ON: collect events, do not inject interventions.
                </p>
              </div>
              <Switch
                id="safeMode"
                name="safeMode"
                defaultChecked={config?.safeMode ?? true}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm">
                Save
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SDK sampling</CardTitle>
          <CardDescription>
            Reduce event volume on high-traffic apps without losing signal where it matters.
            The saved config flows into the install snippet on{' '}
            <code>/dashboard/install</code> - customer redeploys to pick up changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveSampling} className="space-y-4">
            <SamplingSliders initial={samplingConfig} hiddenInputName="samplingJson" />
            <div className="flex justify-end">
              <Button type="submit" size="sm">
                Save sampling
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Route denylist</CardTitle>
          <CardDescription>
            One route per line. Interventions never render on these routes - events still flow.
            Use exact paths like <code>/checkout</code> or <code>/admin</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveDenylist} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="denylist">Routes (one per line)</Label>
              <Textarea
                id="denylist"
                name="denylist"
                rows={5}
                defaultValue={routeDenylist.join('\n')}
                placeholder="/checkout&#10;/admin"
              />
              {routeDenylist.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Currently blocking {routeDenylist.length} route
                  {routeDenylist.length === 1 ? '' : 's'}.
                </p>
              ) : null}
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm">
                Save
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Demo data</CardTitle>
          <CardDescription>
            Generate synthetic events, struggles, and interventions for screenshots / demos /
            screencasts. Idempotent - running it again resets the demo dataset. Clear wipes all
            event data for this org.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {params.seeded ? (
            <div className="mb-4 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
              Seeded the demo dataset.
            </div>
          ) : null}
          {params.cleared ? (
            <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
              Cleared {params.cleared} rows.
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <form action={runSeed}>
              <Button type="submit" variant="outline" size="sm">
                <Sparkles className="h-4 w-4" />
                Seed demo data
              </Button>
            </form>
            <form action={runClear}>
              <Button type="submit" variant="outline" size="sm">
                <Trash2 className="h-4 w-4" />
                Clear all events
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Platform metadata</CardTitle>
          <CardDescription>
            Used as context when the LLM enriches the UI map. Be specific - &ldquo;a B2B billing
            dashboard for SaaS teams&rdquo; produces better intent inference than &ldquo;an
            app&rdquo;.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={savePlatformMeta} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="platformName">Platform name</Label>
              <input
                id="platformName"
                name="platformName"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                defaultValue={config?.platformName ?? ''}
                required
              />
            </div>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="platformDescription">Description</Label>
              <Textarea
                id="platformDescription"
                name="platformDescription"
                rows={4}
                defaultValue={config?.platformDescription ?? ''}
                required
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm">
                Save
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
