import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Activity, ArrowRight, Check } from 'lucide-react'
import { getCurrentOrg } from '@/lib/access'
import { prisma } from '@/lib/db'
import { maskedDisplay } from '@/lib/crypto/keys'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { WizardSteps } from '@/components/onboarding/WizardSteps'

const PROVIDER_LABEL: Record<string, string> = {
  ANTHROPIC: 'Anthropic (Claude)',
  OPENAI: 'OpenAI (GPT)',
  GOOGLE: 'Google',
  CUSTOM: 'Custom',
}

export default async function OnboardingStep5() {
  const ctx = await getCurrentOrg('/onboarding/direct/done')

  const platform = await prisma.platformConfig.findUnique({ where: { orgId: ctx.orgId } })
  if (!platform) redirect('/onboarding/direct')

  const [keys, elementCount, routeCount, detected] = await Promise.all([
    prisma.providerKey.findMany({
      where: { orgId: ctx.orgId },
      select: { kind: true, provider: true, lastFour: true },
    }),
    prisma.uIElement.count({ where: { orgId: ctx.orgId } }),
    prisma.uIRoute.count({ where: { orgId: ctx.orgId } }),
    prisma.detectedFramework.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { detectedAt: 'desc' },
      take: 5,
      select: { frameworkId: true, confidence: true },
    }),
  ])

  const deep = keys.find((k) => k.kind === 'DEEP')
  const fast = keys.find((k) => k.kind === 'FAST')

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
          <WizardSteps current={5} />
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-primary bg-primary/10">
              <Check className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">You&rsquo;re set</h1>
              <p className="text-sm text-muted-foreground">
                Open the dashboard to see live events. Re-run any step from the dashboard
                settings.
              </p>
            </div>
          </div>

          <Card>
            <CardContent className="space-y-5 pt-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Platform
                </p>
                <p className="mt-1 text-sm font-medium">{platform.platformName}</p>
                <p className="mt-1 text-sm text-muted-foreground">{platform.platformDescription}</p>
                {platform.repoUrl ? (
                  <p className="mt-2 text-xs text-muted-foreground">Repo: {platform.repoUrl}</p>
                ) : null}
              </div>
              <Separator />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Deep analysis
                    </p>
                    {deep ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {PROVIDER_LABEL[deep.provider] ?? deep.provider}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        Not set
                      </Badge>
                    )}
                  </div>
                  <p className="font-mono text-sm">
                    {deep ? maskedDisplay(deep.lastFour) : ' - '}
                  </p>
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Fast response
                    </p>
                    {fast ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {PROVIDER_LABEL[fast.provider] ?? fast.provider}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        Not set
                      </Badge>
                    )}
                  </div>
                  <p className="font-mono text-sm">
                    {fast ? maskedDisplay(fast.lastFour) : ' - '}
                  </p>
                </div>
              </div>
              <Separator />
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Mapped elements
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{elementCount}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Mapped routes
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{routeCount}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Frameworks detected
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{detected.length}</p>
                </div>
              </div>
              <Separator />
              <div className="rounded-md bg-muted/30 p-3 text-sm text-muted-foreground">
                Safe mode is{' '}
                <span className="font-medium text-foreground">on</span> for the first 7 days. The
                SDK collects events but never injects interventions until you flip the switch in
                Settings - that&rsquo;s the trust window.
              </div>
            </CardContent>
          </Card>

          <div className="mt-8 flex justify-end gap-3">
            <Link href="/onboarding/direct/repo">
              <Button variant="outline">Back</Button>
            </Link>
            <Link href="/dashboard">
              <Button>
                Go to dashboard
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
