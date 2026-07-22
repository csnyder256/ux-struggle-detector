import Link from 'next/link'
import { Code2, Info, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function EmptyStateBanner({
  message,
  cta = 'both',
}: {
  message?: string
  cta?: 'both' | 'install' | 'seed' | 'none'
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-md border bg-muted/30 p-4 sm:flex-row sm:items-start">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1">
        <p className="text-sm font-medium">We&rsquo;re collecting data.</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {message ??
            'Your first results will appear here once your SDK is installed and reporting events. Estimated time to first results: ~15 minutes after deploy.'}
        </p>
      </div>
      {cta !== 'none' ? (
        <div className="flex flex-wrap gap-2">
          {cta === 'both' || cta === 'install' ? (
            <Link href="/dashboard/install">
              <Button size="sm" variant="outline">
                <Code2 className="h-3 w-3" />
                Install SDK
              </Button>
            </Link>
          ) : null}
          {cta === 'both' || cta === 'seed' ? (
            <Link href="/dashboard/settings">
              <Button size="sm" variant="outline">
                <Sparkles className="h-3 w-3" />
                Seed demo data
              </Button>
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
