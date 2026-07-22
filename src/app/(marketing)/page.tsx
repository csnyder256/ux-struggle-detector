import Link from 'next/link'
import { Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Hero } from '@/components/marketing/Hero'
import { OnboardingCards } from '@/components/marketing/OnboardingCards'
import { HowItWorks } from '@/components/marketing/HowItWorks'
import { FrameworkSupport } from '@/components/marketing/FrameworkSupport'
import { WhyTwoKeys } from '@/components/marketing/WhyTwoKeys'
import { Footer } from '@/components/marketing/Footer'

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Activity className="h-5 w-5" />
            <span>Clarus Heal</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/sign-in">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
            <Link href="/onboarding/direct">
              <Button size="sm">Get started</Button>
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Hero />
        <OnboardingCards />
        <HowItWorks />
        <FrameworkSupport />
        <WhyTwoKeys />
      </main>
      <Footer />
    </div>
  )
}
