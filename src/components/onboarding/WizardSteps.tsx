import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export type WizardStepNumber = 1 | 2 | 3 | 4 | 5

export interface WizardStepsProps {
  current: WizardStepNumber
}

const STEPS: Array<{ n: WizardStepNumber; label: string }> = [
  { n: 1, label: 'Platform' },
  { n: 2, label: 'API keys' },
  { n: 3, label: 'SDK' },
  { n: 4, label: 'Repo' },
  { n: 5, label: 'Done' },
]

export function WizardSteps({ current }: WizardStepsProps) {
  return (
    <ol className="mb-8 flex flex-wrap items-center gap-x-2 gap-y-3 text-sm">
      {STEPS.map((step, idx) => {
        const done = step.n < current
        const active = step.n === current
        return (
          <li key={step.n} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                done
                  ? 'border-primary bg-primary text-primary-foreground'
                  : active
                    ? 'border-primary text-primary'
                    : 'border-muted-foreground/30 text-muted-foreground',
              )}
            >
              {done ? <Check className="h-4 w-4" /> : step.n}
            </span>
            <span
              className={cn(
                'font-medium',
                active ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {step.label}
            </span>
            {idx < STEPS.length - 1 ? (
              <span className="mx-2 hidden h-px w-8 bg-border sm:inline-block" aria-hidden />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
