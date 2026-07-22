'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SwitchProps {
  id?: string
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  name?: string
  className?: string
  'aria-label'?: string
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ id, checked, defaultChecked, onCheckedChange, disabled, name, className, ...props }, ref) => {
    const [internalChecked, setInternalChecked] = React.useState(defaultChecked ?? false)
    const isControlled = checked !== undefined
    const value = isControlled ? checked : internalChecked

    return (
      <button
        ref={ref}
        id={id}
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={() => {
          const next = !value
          if (!isControlled) setInternalChecked(next)
          onCheckedChange?.(next)
        }}
        className={cn(
          'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          value ? 'bg-primary' : 'bg-input',
          className,
        )}
        {...props}
      >
        <span
          aria-hidden
          className={cn(
            'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform',
            value ? 'translate-x-4' : 'translate-x-0',
          )}
        />
        {name ? <input type="hidden" name={name} value={value ? 'on' : 'off'} /> : null}
      </button>
    )
  },
)
Switch.displayName = 'Switch'
