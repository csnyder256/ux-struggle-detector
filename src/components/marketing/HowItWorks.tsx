import { Code2, Eye, Wand2 } from 'lucide-react'

const PILLARS = [
  {
    icon: Code2,
    title: 'Static Mapper',
    description:
      'We parse your codebase and build a complete inventory of every interactive element, route, and handler. Then an LLM enriches each one with intent and expected outcome.',
  },
  {
    icon: Eye,
    title: 'Runtime Observer',
    description:
      'A 10 KB SDK captures clicks, inputs, submits, and navigation. Built-in pattern detection catches rage clicks, navigation loops, form thrashing, and silent failures - without DOM scraping in production.',
  },
  {
    icon: Wand2,
    title: 'Intervention Engine',
    description:
      'When struggle is detected, we surface "Looks like you\'re trying to ___" with the right element highlighted. Always reversible. Always dismissible. Safe-mode is on by default for the first week.',
  },
] as const

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-b">
      <div className="container mx-auto max-w-6xl px-6 py-20">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
          <p className="mt-3 text-muted-foreground">
            Three layers. Cleanly separated. Each one independently useful.
          </p>
        </div>
        <div className="grid gap-10 md:grid-cols-3">
          {PILLARS.map((pillar) => {
            const Icon = pillar.icon
            return (
              <div key={pillar.title}>
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border bg-muted/30">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">{pillar.title}</h3>
                <p className="text-sm text-muted-foreground">{pillar.description}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
