import { Brain, Zap } from 'lucide-react'

export function WhyTwoKeys() {
  return (
    <section className="border-b bg-muted/20">
      <div className="container mx-auto max-w-5xl px-6 py-20">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">Why two API keys?</h2>
          <p className="mt-3 text-muted-foreground">
            One for thinking. One for reacting. Same key works for both - but separating them is
            usually better.
          </p>
        </div>
        <div className="grid gap-8 md:grid-cols-2">
          <div className="rounded-lg border bg-background p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md border bg-muted/30">
              <Brain className="h-5 w-5" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">Deep analysis key</h3>
            <p className="text-sm text-muted-foreground">
              Used during platform mapping. We give the model time to deeply analyze your code and
              produce rich, structured JSON. More reasoning time → more accurate semantic
              understanding of every button, form, and flow.
            </p>
          </div>
          <div className="rounded-lg border bg-background p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md border bg-muted/30">
              <Zap className="h-5 w-5" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">Fast response key</h3>
            <p className="text-sm text-muted-foreground">
              Used at runtime when a user struggles. Sub-second responses are critical to surface
              the right recommendation while the user is still on the page. Speed beats depth here.
            </p>
          </div>
        </div>
        <div className="mt-8 rounded-lg border-l-4 border-primary bg-background p-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Why two keys is recommended: </span>
          (1) different model families excel at different tasks - one provider may shine at deep
          reasoning, another at fast inference; (2) mapping work won&rsquo;t compete with runtime
          traffic for rate limits; (3) you can track and budget the two cost streams independently.
        </div>
      </div>
    </section>
  )
}
