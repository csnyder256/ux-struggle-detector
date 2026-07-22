'use client'

import * as React from 'react'

const SAMPLING_TYPES = [
  { id: 'CLICK', label: 'Click', hint: 'Primary signal - recommended 100%' },
  { id: 'INPUT_CHANGE', label: 'Input change', hint: 'Form fills' },
  { id: 'SUBMIT', label: 'Submit', hint: 'Form submissions' },
  { id: 'NAVIGATION', label: 'Navigation', hint: 'Route changes' },
  { id: 'HOVER', label: 'Hover', hint: 'High-volume - sample down on busy apps' },
  { id: 'DWELL', label: 'Dwell', hint: 'Fires every ~30s of idle time' },
  { id: 'PASTE', label: 'Paste', hint: 'Form-paste detection' },
  { id: 'COPY', label: 'Copy', hint: 'Copy + bounce detection' },
  { id: 'FOCUS', label: 'Focus', hint: 'Field focus' },
  { id: 'BLUR', label: 'Blur', hint: 'Field blur (incl. abandoned-field)' },
  { id: 'KEY_DOWN', label: 'Key down', hint: 'Keyboard activity (high-volume)' },
] as const

type EventTypeId = (typeof SAMPLING_TYPES)[number]['id']

export interface SamplingConfig {
  default?: number
  byType?: Partial<Record<EventTypeId, number>>
}

export function SamplingSliders({
  initial,
  hiddenInputName,
}: {
  initial: SamplingConfig
  hiddenInputName: string
}) {
  const [defaultRate, setDefaultRate] = React.useState(
    typeof initial.default === 'number' ? initial.default : 1,
  )
  const [byType, setByType] = React.useState<Partial<Record<EventTypeId, number>>>(
    initial.byType ?? {},
  )

  const json = React.useMemo(() => {
    const out: SamplingConfig = {}
    if (defaultRate !== 1) out.default = round(defaultRate)
    const trimmed: Partial<Record<EventTypeId, number>> = {}
    for (const k of Object.keys(byType) as EventTypeId[]) {
      const v = byType[k]
      if (typeof v === 'number' && v !== defaultRate) trimmed[k] = round(v)
    }
    if (Object.keys(trimmed).length > 0) out.byType = trimmed
    return JSON.stringify(out)
  }, [defaultRate, byType])

  return (
    <div className="space-y-4">
      <SliderRow
        label="All event types (default)"
        hint="Default sampling rate for any event without an override below."
        value={defaultRate}
        onChange={setDefaultRate}
      />
      <div className="rounded-md border bg-muted/40 p-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Per-type overrides
        </div>
        <div className="space-y-3">
          {SAMPLING_TYPES.map((t) => {
            const value = byType[t.id] ?? defaultRate
            return (
              <SliderRow
                key={t.id}
                label={t.label}
                hint={t.hint}
                value={value}
                onChange={(v) =>
                  setByType((prev) => ({ ...prev, [t.id]: v }))
                }
                onClear={() => {
                  setByType((prev) => {
                    const next = { ...prev }
                    delete next[t.id]
                    return next
                  })
                }}
                cleared={byType[t.id] === undefined}
              />
            )
          })}
        </div>
      </div>
      <input type="hidden" name={hiddenInputName} value={json} />
      <p className="text-xs text-muted-foreground">
        Saved configs are surfaced into the install snippet on{' '}
        <code>/dashboard/install</code>. Customer redeploys to pick up changes.
        <br />
        <code>JS_ERROR</code> and <code>VALIDATION_ERROR</code> are always sampling-exempt - they&rsquo;re cheap and load-bearing.
      </p>
    </div>
  )
}

function SliderRow({
  label,
  hint,
  value,
  onChange,
  onClear,
  cleared,
}: {
  label: string
  hint?: string
  value: number
  onChange: (v: number) => void
  onClear?: () => void
  cleared?: boolean
}) {
  const pct = Math.round(value * 100)
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <div className="min-w-0">
          <span className="font-medium">{label}</span>
          {hint ? <span className="ml-2 text-xs text-muted-foreground">{hint}</span> : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`tabular-nums ${cleared ? 'text-muted-foreground italic' : 'font-medium'}`}
          >
            {pct}%
          </span>
          {onClear && !cleared ? (
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-muted-foreground hover:underline"
              aria-label={`Reset ${label} to default rate`}
            >
              reset
            </button>
          ) : null}
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="block h-2 w-full cursor-pointer appearance-none rounded-md bg-muted accent-primary"
      />
    </div>
  )
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
