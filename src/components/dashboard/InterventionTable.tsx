import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatNumber, formatPercent } from '@/lib/utils'

export interface InterventionRow {
  id: string
  copy: string
  elementLabel: string | null
  type: string
  enabled: boolean
  variantGroup: string | null
  impressions: number
  successes: number
  dismissals: number
  successRate: number
}

const TYPE_VARIANT: Record<string, 'default' | 'warning' | 'destructive' | 'secondary' | 'success'> = {
  OVERLAY: 'default',
  HIGHLIGHT: 'success',
  TOOLTIP: 'success',
  MODAL: 'default',
  BANNER: 'default',
  INLINE_HINT: 'success',
  SPOTLIGHT: 'success',
  TOUR: 'default',
  ICON_FLASH: 'success',
  ARROW: 'success',
  DOM: 'warning',
  BEHAVIOR: 'destructive',
  AUTO_FIX: 'destructive',
  CONFIRM: 'default',
  ANNOUNCE: 'secondary',
}
function variantFor(t: string) {
  return TYPE_VARIANT[t] ?? 'secondary'
}

export interface InterventionTableProps {
  rows: InterventionRow[]
  /** Server action that toggles the enabled flag on a single row. */
  toggleAction?: (formData: FormData) => Promise<void>
}

export function InterventionTable({ rows, toggleAction }: InterventionTableProps) {
  if (rows.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Interventions will appear here once analysis has run on collected events.
      </div>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Copy / element</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Variant</TableHead>
          <TableHead className="text-right">Imps</TableHead>
          <TableHead className="text-right">Success rate</TableHead>
          <TableHead className="text-right">Dismissals</TableHead>
          <TableHead>Status</TableHead>
          {toggleAction ? <TableHead></TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="max-w-sm">
              <div className="truncate font-medium">{row.copy}</div>
              <div className="truncate text-xs text-muted-foreground">
                on {row.elementLabel ?? '(unlabeled element)'}
              </div>
            </TableCell>
            <TableCell>
              <Badge variant={variantFor(row.type)}>{row.type}</Badge>
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {row.variantGroup ?? ' - '}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatNumber(row.impressions)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.impressions > 0 ? formatPercent(row.successRate) : ' - '}
            </TableCell>
            <TableCell className="text-right tabular-nums">{row.dismissals}</TableCell>
            <TableCell>
              <Badge variant={row.enabled ? 'success' : 'secondary'}>
                {row.enabled ? 'Active' : 'Paused'}
              </Badge>
            </TableCell>
            {toggleAction ? (
              <TableCell>
                <form action={toggleAction}>
                  <input type="hidden" name="id" value={row.id} />
                  <input type="hidden" name="next" value={row.enabled ? 'pause' : 'enable'} />
                  <Button type="submit" variant="ghost" size="sm">
                    {row.enabled ? 'Pause' : 'Enable'}
                  </Button>
                </form>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
