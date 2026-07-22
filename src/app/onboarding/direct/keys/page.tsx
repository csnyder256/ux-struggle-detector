import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Activity, Brain, Zap } from 'lucide-react'
import { getCurrentOrg } from '@/lib/access'
import { prisma } from '@/lib/db'
import { encryptApiKey, lastFour } from '@/lib/crypto/keys'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { WizardSteps } from '@/components/onboarding/WizardSteps'
import { ProviderSelect } from '@/components/onboarding/ProviderSelect'

export default async function OnboardingStep2() {
  const ctx = await getCurrentOrg('/onboarding/direct/keys')

  const platform = await prisma.platformConfig.findUnique({
    where: { orgId: ctx.orgId },
  })
  if (!platform) {
    redirect('/onboarding/direct')
  }

  const existingKeys = await prisma.providerKey.findMany({
    where: { orgId: ctx.orgId },
    select: { kind: true, provider: true, lastFour: true },
  })
  const existingDeep = existingKeys.find((k) => k.kind === 'DEEP')
  const existingFast = existingKeys.find((k) => k.kind === 'FAST')

  async function saveKeys(formData: FormData) {
    'use server'
    const c = await getCurrentOrg('/onboarding/direct/keys')

    const deepKeyRaw = String(formData.get('deepKey') ?? '').trim()
    const fastKeyRaw = String(formData.get('fastKey') ?? '').trim()
    const deepProvider = String(formData.get('deepProvider') ?? '') as 'ANTHROPIC' | 'OPENAI'
    const fastProvider = String(formData.get('fastProvider') ?? '') as 'ANTHROPIC' | 'OPENAI'
    const skip = formData.get('action') === 'skip'

    if (!skip) {
      const existing = await prisma.providerKey.findMany({
        where: { orgId: c.orgId },
        select: { kind: true },
      })
      const hasDeep = existing.some((k) => k.kind === 'DEEP')
      const hasFast = existing.some((k) => k.kind === 'FAST')

      // Allow blank to mean "don't change" if a key is already on file.
      // In dev mode the user can still continue without keys; we just won't
      // be able to LLM-enrich until they're set.
      if (deepKeyRaw) {
        const enc = encryptApiKey(deepKeyRaw)
        await prisma.providerKey.upsert({
          where: { orgId_kind: { orgId: c.orgId, kind: 'DEEP' } },
          create: {
            orgId: c.orgId,
            kind: 'DEEP',
            provider: deepProvider,
            encryptedKey: enc.ciphertext,
            iv: enc.iv,
            lastFour: lastFour(deepKeyRaw),
          },
          update: {
            provider: deepProvider,
            encryptedKey: enc.ciphertext,
            iv: enc.iv,
            lastFour: lastFour(deepKeyRaw),
            rotatedAt: new Date(),
          },
        })
      } else if (hasDeep && deepProvider) {
        await prisma.providerKey.update({
          where: { orgId_kind: { orgId: c.orgId, kind: 'DEEP' } },
          data: { provider: deepProvider },
        })
      }

      if (fastKeyRaw) {
        const enc = encryptApiKey(fastKeyRaw)
        await prisma.providerKey.upsert({
          where: { orgId_kind: { orgId: c.orgId, kind: 'FAST' } },
          create: {
            orgId: c.orgId,
            kind: 'FAST',
            provider: fastProvider,
            encryptedKey: enc.ciphertext,
            iv: enc.iv,
            lastFour: lastFour(fastKeyRaw),
          },
          update: {
            provider: fastProvider,
            encryptedKey: enc.ciphertext,
            iv: enc.iv,
            lastFour: lastFour(fastKeyRaw),
            rotatedAt: new Date(),
          },
        })
      } else if (hasFast && fastProvider) {
        await prisma.providerKey.update({
          where: { orgId_kind: { orgId: c.orgId, kind: 'FAST' } },
          data: { provider: fastProvider },
        })
      }
    }

    redirect('/onboarding/direct/sdk')
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
          <WizardSteps current={2} />
          <h1 className="text-3xl font-semibold tracking-tight">Connect your API keys</h1>
          <p className="mt-2 text-muted-foreground">
            Two slots. Same key works for both. Stored AES-GCM encrypted; never echoed to the
            browser, never logged. You can also skip this and add keys later from the dashboard.
          </p>

          <Card className="mt-8">
            <CardContent className="pt-6">
              <form action={saveKeys} className="space-y-8">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted/30">
                      <Brain className="h-4 w-4" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold">Deep analysis key</h2>
                      <p className="text-sm text-muted-foreground">
                        Mapping-time. Slow, structured-JSON output. Used to enrich every UI element
                        with semantic intent.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
                    <div className="space-y-2">
                      <Label htmlFor="deepKey">API key</Label>
                      <Input
                        id="deepKey"
                        name="deepKey"
                        type="password"
                        autoComplete="off"
                        placeholder={
                          existingDeep
                            ? `••••••••${existingDeep.lastFour} (leave blank to keep)`
                            : 'sk-ant-api03-...  or  sk-...'
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="deepProvider">Provider</Label>
                      <ProviderSelect
                        id="deepProvider"
                        name="deepProvider"
                        defaultValue={existingDeep?.provider === 'OPENAI' ? 'OPENAI' : 'ANTHROPIC'}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted/30">
                      <Zap className="h-4 w-4" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold">Fast response key</h2>
                      <p className="text-sm text-muted-foreground">
                        Runtime. Sub-second. Used the moment a struggle is detected to pick the
                        right intervention copy + target.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
                    <div className="space-y-2">
                      <Label htmlFor="fastKey">API key</Label>
                      <Input
                        id="fastKey"
                        name="fastKey"
                        type="password"
                        autoComplete="off"
                        placeholder={
                          existingFast
                            ? `••••••••${existingFast.lastFour} (leave blank to keep)`
                            : 'sk-ant-api03-...  or  sk-...'
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="fastProvider">Provider</Label>
                      <ProviderSelect
                        id="fastProvider"
                        name="fastProvider"
                        defaultValue={existingFast?.provider === 'OPENAI' ? 'OPENAI' : 'ANTHROPIC'}
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border-l-4 border-primary bg-muted/30 p-4 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Why two keys is recommended:</span>{' '}
                  (1) different model families excel at different tasks; (2) mapping work
                  won&rsquo;t compete with runtime traffic for rate limits; (3) you can track and
                  budget the two cost streams independently.
                </div>

                <div className="flex justify-between gap-3 pt-2">
                  <Button type="submit" name="action" value="skip" variant="ghost">
                    Skip for now
                  </Button>
                  <div className="flex gap-3">
                    <Link href="/onboarding/direct">
                      <Button type="button" variant="outline">
                        Back
                      </Button>
                    </Link>
                    <Button type="submit">Save and continue</Button>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
