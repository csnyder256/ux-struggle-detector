import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatRelativeTime } from '@/lib/utils'

export interface FrictionRow {
  id: string
  elementLabel: string | null
  elementId: string | null
  route: string
  type: string
  severity: number
  occurrences: number
  lastSeen: string
}

const TYPE_LABEL: Record<string, string> = {
  RAGE_CLICK: 'Rage click',
  DEAD_CLICK: 'Dead click',
  INVALID_CLICK: 'Disabled click',
  MIS_CLICK: 'Mis-click',
  THRASH: 'Form thrash',
  BACKTRACK: 'Backtracking',
  VALIDATION_LOOP: 'Validation loop',
  ABANDONED_FIELD: 'Abandoned field',
  PASTE_REPEAT: 'Repeated paste',
  REQUIRED_MISSED: 'Required missed',
  FORMAT_ERROR: 'Format error',
  PASSWORD_RETRY: 'Password retry',
  SLOW_FILL: 'Slow fill',
  LOOP: 'Navigation loop',
  SILENT_FAIL: 'Silent failure',
  BACK_THRASH: 'Back-button thrash',
  DEAD_END: 'Dead end',
  QUICK_BOUNCE: 'Quick bounce',
  CIRCULAR_NAV: 'Circular nav',
  HOVER_HUNT: 'Hover hunt',
  LONG_DWELL: 'Long dwell',
  RAPID_SCROLL: 'Rapid scroll',
  SCROLL_OVERSHOOT: 'Scroll overshoot',
  IDLE_AFTER_LOAD: 'Idle after load',
  EMPTY_SEARCH: 'Empty search',
  REPEAT_SEARCH: 'Repeated search',
  ZERO_RESULTS: 'Zero results',
  FAILED_FILTER: 'Failed filter',
  MENU_THRASH: 'Menu thrash',
  TOOLTIP_HOVER_REPEAT: 'Tooltip re-read',
  TAB_HOPPING: 'Tab hopping',
  ERROR_DISMISS: 'Error dismissed',
  RETRY_LOOP: 'Retry loop',
  NOT_FOUND_BOUNCE: '404 bounce',
  JS_ERROR: 'JS error',
  LOGIN_FAILURE: 'Login failure',
  LOCKED_OUT: 'Locked out',
  KEYBOARD_LOST_FOCUS: 'Lost focus',
  COPY_BOUNCE: 'Copy + bounce',
  HELP_HUNT: 'Help hunt',
}

const TYPE_VARIANT: Record<string, 'destructive' | 'warning' | 'secondary' | 'default'> = {
  RAGE_CLICK: 'destructive',
  JS_ERROR: 'destructive',
  LOCKED_OUT: 'destructive',
  SILENT_FAIL: 'destructive',
  LOOP: 'warning',
  THRASH: 'warning',
  VALIDATION_LOOP: 'warning',
  RETRY_LOOP: 'warning',
  ERROR_DISMISS: 'warning',
  NOT_FOUND_BOUNCE: 'warning',
}

function variantFor(t: string) {
  return TYPE_VARIANT[t] ?? 'secondary'
}
function labelFor(t: string) {
  return TYPE_LABEL[t] ?? t.replace(/_/g, ' ')
}

export function FrictionTable({ rows }: { rows: FrictionRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        No friction events yet. They&rsquo;ll appear here as the SDK detects struggle patterns.
      </div>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Element</TableHead>
          <TableHead>Route</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Severity</TableHead>
          <TableHead className="text-right">Occurrences</TableHead>
          <TableHead className="text-right">Last seen</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              {row.elementId ? (
                <Link
                  href={`/dashboard/elements/${encodeURIComponent(row.elementId)}`}
                  className="group inline-flex items-start gap-1 hover:text-primary"
                >
                  <span className="flex flex-col">
                    <span className="font-medium group-hover:underline">
                      {row.elementLabel ?? '(unlabeled)'}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">{row.elementId}</span>
                  </span>
                  <ArrowRight className="mt-1 h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              ) : (
                <div>
                  <div className="font-medium">{row.elementLabel ?? '(unlabeled)'}</div>
                </div>
              )}
            </TableCell>
            <TableCell className="font-mono text-xs">{row.route}</TableCell>
            <TableCell>
              <Badge variant={variantFor(row.type)}>{labelFor(row.type)}</Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">{row.severity.toFixed(2)}</TableCell>
            <TableCell className="text-right tabular-nums">{row.occurrences}</TableCell>
            <TableCell className="text-right text-muted-foreground">
              {formatRelativeTime(row.lastSeen)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
