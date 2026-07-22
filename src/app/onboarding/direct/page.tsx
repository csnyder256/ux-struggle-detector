import Link from 'next/link'
import { Activity } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getCurrentOrg } from '@/lib/access'
import { prisma } from '@/lib/db'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { WizardSteps } from '@/components/onboarding/WizardSteps'

export default async function OnboardingStep1() {
  const ctx = await getCurrentOrg('/onboarding/direct')

  const existing = await prisma.platformConfig.findUnique({
    where: { orgId: ctx.orgId },
  })

  async function savePlatform(formData: FormData) {
    'use server'
    const c = await getCurrentOrg('/onboarding/direct')
    const platformName = String(formData.get('platformName') ?? '').trim()
    const platformDescription = String(formData.get('platformDescription') ?? '').trim()
    const repoUrl = String(formData.get('repoUrl') ?? '').trim() || null
    const crawlerTarget = String(formData.get('crawlerTarget') ?? '').trim() || null

    if (!platformName || !platformDescription) {
      throw new Error('Platform name and description are required.')
    }

    await prisma.platformConfig.upsert({
      where: { orgId: c.orgId },
      create: {
        orgId: c.orgId,
        platformName,
        platformDescription,
        repoUrl,
        crawlerTarget,
      },
      update: { platformName, platformDescription, repoUrl, crawlerTarget },
    })

    redirect('/onboarding/direct/keys')
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
          <WizardSteps current={1} />
          <h1 className="text-3xl font-semibold tracking-tight">Tell us about your platform</h1>
          <p className="mt-2 text-muted-foreground">
            Used as context when the LLM enriches your UI map. The more accurate this is, the
            better the semantic understanding.
          </p>

          <Card className="mt-8">
            <CardContent className="pt-6">
              <form action={savePlatform} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="platformName">
                    Platform name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="platformName"
                    name="platformName"
                    required
                    defaultValue={existing?.platformName ?? ''}
                    placeholder="Acme Inc"
                    autoFocus
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="platformDescription">
                    What does your platform do?{' '}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="platformDescription"
                    name="platformDescription"
                    required
                    rows={4}
                    defaultValue={existing?.platformDescription ?? ''}
                    placeholder="e.g., A B2B billing dashboard for SaaS companies. Customers manage subscriptions, view invoices, and configure tax settings."
                  />
                  <p className="text-xs text-muted-foreground">
                    Plain English. One paragraph is plenty.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="repoUrl">Repository URL (optional, can also do this in step 4)</Label>
                  <Input
                    id="repoUrl"
                    name="repoUrl"
                    defaultValue={existing?.repoUrl ?? ''}
                    placeholder="https://github.com/acme/app  OR  C:\path\to\local\repo"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="crawlerTarget">Crawler target URL (optional)</Label>
                  <Input
                    id="crawlerTarget"
                    name="crawlerTarget"
                    type="url"
                    defaultValue={existing?.crawlerTarget ?? ''}
                    placeholder="https://app.acme.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    For when you don&rsquo;t have repo access. Crawler runs are queued for the
                    background worker.
                  </p>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Link href="/">
                    <Button type="button" variant="outline">
                      Back
                    </Button>
                  </Link>
                  <Button type="submit">Continue</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
