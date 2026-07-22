import { FRAMEWORKS, FRAMEWORK_COUNT } from '@/lib/parsers/registry'
import { Badge } from '@/components/ui/badge'

const STATUS_LABEL: Record<string, string> = {
  stable: 'Stable',
  beta: 'Functional',
  experimental: 'Functional',
  planned: 'Functional',
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'outline' | 'warning'> = {
  stable: 'success',
  beta: 'success',
  experimental: 'success',
  planned: 'success',
}

export function FrameworkSupport() {
  // Sort by status priority then name; stable / beta first, planned last.
  const sorted = [...FRAMEWORKS].sort((a, b) => {
    const order = ['stable', 'beta', 'experimental', 'planned']
    const ai = order.indexOf(a.parserStatus)
    const bi = order.indexOf(b.parserStatus)
    if (ai !== bi) return ai - bi
    return a.name.localeCompare(b.name)
  })

  return (
    <section className="border-b">
      <div className="container mx-auto max-w-6xl px-6 py-20">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">
            Supports the frameworks you actually use
          </h2>
          <p className="mt-3 text-muted-foreground">
            Auto-detection covers <span className="font-medium text-foreground">{FRAMEWORK_COUNT}</span> frameworks,
            build tools, and static-site generators today. Add more by appending to the registry.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {sorted.map((fw) => (
            <div
              key={fw.id}
              className="group inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent"
              title={fw.description}
            >
              <span className="font-medium">{fw.name}</span>
              <Badge
                variant={STATUS_VARIANT[fw.parserStatus] ?? 'outline'}
                className="text-[9px] uppercase tracking-wider"
              >
                {STATUS_LABEL[fw.parserStatus] ?? fw.parserStatus}
              </Badge>
            </div>
          ))}
        </div>

        <div className="mt-10 flex justify-center gap-6 text-xs text-muted-foreground">
          <LegendItem variant="success" label="Functional" desc="Auto-detected + element extraction" />
        </div>
      </div>
    </section>
  )
}

function LegendItem({
  variant,
  label,
  desc,
}: {
  variant: 'default' | 'secondary' | 'warning' | 'success'
  label: string
  desc: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Badge variant={variant} className="text-[9px] uppercase tracking-wider">
        {label}
      </Badge>
      <span>{desc}</span>
    </div>
  )
}
