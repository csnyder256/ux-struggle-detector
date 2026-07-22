'use client'

import Link from 'next/link'
import { Activity, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <Activity className="h-5 w-5" />
        <span>Clarus Heal</span>
      </Link>
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-destructive/40 bg-destructive/10">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <div className="max-w-lg space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Something broke.</h1>
        <p className="text-sm text-muted-foreground">
          The server hit an error rendering this page. The most common cause in dev is a missing
          database migration - try{' '}
          <code className="font-mono text-xs">pnpm db:migrate</code> in your terminal, then come
          back.
        </p>
        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground">digest: {error.digest}</p>
        ) : null}
        {process.env.NODE_ENV !== 'production' && error.message ? (
          <pre className="mt-4 max-h-48 overflow-auto rounded-md border bg-muted/30 p-3 text-left font-mono text-[11px] text-muted-foreground">
            {error.message}
          </pre>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/">
          <Button variant="outline">Home</Button>
        </Link>
        <Link href="/api/health">
          <Button variant="ghost" size="sm">
            Check /api/health
          </Button>
        </Link>
      </div>
    </div>
  )
}
