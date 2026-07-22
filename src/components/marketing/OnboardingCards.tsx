import Link from 'next/link'
import { ArrowRight, Github, Globe, KeyRound, Zap } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const PATHS = [
  {
    href: '/onboarding/github',
    icon: Github,
    title: 'Connect GitHub',
    description:
      'OAuth into your repo. We auto-detect your framework, parse routes, components, and handlers, and build a complete map of every interactive element.',
    cta: 'Install GitHub App',
    badge: 'Recommended for production',
    badgeVariant: 'secondary' as const,
    accent: 'from-slate-500/10 to-slate-500/0',
    available: true,
    bullets: ['Read-only repo access', 'Auto-framework detection', 'Webhook-driven re-mapping'],
  },
  {
    href: '/onboarding/crawler',
    icon: Globe,
    title: 'Crawl your platform',
    description:
      'Point us at a URL and we extract every interactive element from the rendered HTML. Works great for SSR, static sites, FastHTML, and pre-rendered marketing pages.',
    cta: 'Set up crawler',
    badge: 'For legacy / SSR apps',
    badgeVariant: 'outline' as const,
    accent: 'from-blue-500/10 to-blue-500/0',
    available: true,
    bullets: ['No repo needed', 'Single-URL HTML scrape', 'Headless browser coming next'],
  },
  {
    href: '/onboarding/direct',
    icon: KeyRound,
    title: 'Direct setup',
    description:
      'Paste your platform info and your own API keys. The fastest way to get the dashboard live, see the schema, and start mapping.',
    cta: 'Continue with keys',
    badge: 'Fastest start',
    badgeVariant: 'default' as const,
    accent: 'from-violet-500/15 to-violet-500/0',
    available: true,
    bullets: ['Live in under 2 minutes', 'Bring your own LLM keys', 'Two-key (deep + fast) model'],
  },
] as const

export function OnboardingCards() {
  return (
    <section className="border-b">
      <div className="container mx-auto max-w-6xl px-6 py-20">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">Three ways to start</h2>
          <p className="mt-3 text-muted-foreground">
            Pick the path that fits your stack. You can change later, or run multiple in parallel.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {PATHS.map((path) => {
            const Icon = path.icon
            return (
              <Link
                key={path.href}
                href={path.href}
                className="group relative focus:outline-none"
              >
                <Card
                  className={cn(
                    'relative h-full overflow-hidden border-border/60 transition-all duration-200',
                    'group-hover:-translate-y-1 group-hover:border-border group-hover:shadow-md',
                    'group-focus-visible:ring-2 group-focus-visible:ring-ring',
                    !path.available && 'opacity-90',
                  )}
                >
                  <div
                    aria-hidden
                    className={cn(
                      'pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b opacity-90',
                      path.accent,
                    )}
                  />
                  <CardHeader className="relative">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-background/80 shadow-sm backdrop-blur">
                        <Icon className="h-5 w-5" />
                      </div>
                      <Badge variant={path.badgeVariant}>{path.badge}</Badge>
                    </div>
                    <CardTitle className="text-xl">{path.title}</CardTitle>
                    <CardDescription className="mt-2">{path.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="relative">
                    <ul className="mb-5 space-y-1.5 text-sm text-muted-foreground">
                      {path.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-2">
                          <Zap className="mt-0.5 h-3 w-3 shrink-0 text-foreground/60" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center gap-1 text-sm font-medium">
                      {path.available ? (
                        <>
                          <span>{path.cta}</span>
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </>
                      ) : (
                        <span className="text-muted-foreground">Join the waitlist →</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}
