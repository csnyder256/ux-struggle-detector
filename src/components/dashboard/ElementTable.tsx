import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatNumber, formatPercent } from '@/lib/utils'

export interface ElementRow {
  id: string
  label: string | null
  semanticName: string | null
  route: string | null
  filePath: string
  impressions: number
  successes: number
  topStruggleType: string | null
}

export function ElementTable({ rows }: { rows: ElementRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Once the static map is built and events are flowing, every interactive element gets a row
        here.
      </div>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Element</TableHead>
          <TableHead>Semantic name</TableHead>
          <TableHead>Route</TableHead>
          <TableHead className="text-right">Impressions</TableHead>
          <TableHead className="text-right">Success rate</TableHead>
          <TableHead>Top struggle</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const successRate = row.impressions > 0 ? row.successes / row.impressions : 0
          return (
            <TableRow key={row.id}>
              <TableCell>
                <Link
                  href={`/dashboard/elements/${encodeURIComponent(row.id)}`}
                  className="group inline-flex items-start gap-1 hover:text-primary"
                >
                  <span className="flex flex-col">
                    <span className="font-medium group-hover:underline">
                      {row.label ?? '(unlabeled)'}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">{row.filePath}</span>
                  </span>
                  <ArrowRight className="mt-1 h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.semanticName ?? <span className="italic">not enriched</span>}
              </TableCell>
              <TableCell className="font-mono text-xs">{row.route ?? ' - '}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(row.impressions)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.impressions > 0 ? formatPercent(successRate) : ' - '}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.topStruggleType ?? ' - '}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
