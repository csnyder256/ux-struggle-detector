import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Activity, Code2, ExternalLink, Sparkles } from 'lucide-react'
import { getCurrentOrg } from '@/lib/access'
import { prisma } from '@/lib/db'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { WizardSteps } from '@/components/onboarding/WizardSteps'
import { SdkSnippet } from '@/components/onboarding/SdkSnippet'

export default async function OnboardingStep3() {
  const ctx = await getCurrentOrg('/onboarding/direct/sdk')

  // Step gate: must have completed step 1.
  const platform = await prisma.platformConfig.findUnique({
    where: { orgId: ctx.orgId },
    select: { id: true },
  })
  if (!platform) redirect('/onboarding/direct')

  const baseUrl = process.env.AUTH_URL || 'http://localhost:3000'

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
          <WizardSteps current={3} />
          <h1 className="text-3xl font-semibold tracking-tight">Drop in the SDK</h1>
          <p className="mt-2 text-muted-foreground">
            One script tag. The SDK captures clicks, submits, inputs, navigation, hovers, scroll,
            and dwell time, and renders interventions when struggle is detected.
          </p>

          <Card className="mt-8">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Code2 className="h-5 w-5" />
                <CardTitle>Script tag</CardTitle>
                <Badge variant="success" className="ml-auto">
                  6.2 KB minified
                </Badge>
              </div>
              <CardDescription>
                Paste this just before <code className="font-mono">&lt;/body&gt;</code> in your
                app&rsquo;s HTML, or in your root layout if you&rsquo;re on a SPA framework.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SdkSnippet baseUrl={baseUrl} orgId={ctx.orgId} />
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                <CardTitle>Try it now</CardTitle>
              </div>
              <CardDescription>
                The bundled demo page wires the SDK up against synthetic buttons + forms so you
                can see the rage-click intervention fire without setting up a real test app.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Link href="/demo/" target="_blank">
                <Button>
                  Open demo
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/api/events" target="_blank">
                <Button variant="outline">
                  Inspect /api/events
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          <div className="mt-8 flex justify-end gap-3">
            <Link href="/onboarding/direct/keys">
              <Button variant="outline">Back</Button>
            </Link>
            <Link href="/onboarding/direct/repo">
              <Button>Continue to repo mapping</Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
