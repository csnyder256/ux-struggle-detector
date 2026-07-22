import Link from 'next/link'
import { ArrowRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b">
      {/* Subtle gradient background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(120,119,198,0.18),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.04)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]"
      />

      <div className="relative container mx-auto flex max-w-5xl flex-col items-center px-6 py-28 text-center">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
          <Sparkles className="h-3 w-3" />
          Plug-and-play. No rewrites. No DOM scraping.
        </span>
        <h1 className="text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
          Self-healing UX <br className="hidden sm:inline" />
          for the apps you already shipped.
        </h1>
        <p className="mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
          Connect your repo or drop in our SDK. We map your UI, infer what every element is for,
          and surface{' '}
          <span className="font-medium text-foreground">
            &ldquo;Looks like you&rsquo;re trying to&hellip;&rdquo;
          </span>{' '}
          the moment a user gets stuck.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Link href="/onboarding/direct" className="w-full sm:w-auto">
            <Button size="lg" className="w-full gap-1 sm:w-auto">
              Try it now
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="#how-it-works" className="w-full sm:w-auto">
            <Button size="lg" variant="outline" className="w-full sm:w-auto">
              How it works
            </Button>
          </Link>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          One-line SDK install · Works with any frontend framework · 7-day safe mode by default
        </p>
      </div>
    </section>
  )
}
