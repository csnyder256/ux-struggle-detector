import Link from 'next/link'
import { Activity, Compass } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <Activity className="h-5 w-5" />
        <span>Clarus Heal</span>
      </Link>
      <div className="flex h-12 w-12 items-center justify-center rounded-full border bg-muted/30">
        <Compass className="h-6 w-6" />
      </div>
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found.</h1>
        <p className="text-sm text-muted-foreground">
          That URL doesn&rsquo;t map to anything. Check the URL or head back to the dashboard.
        </p>
      </div>
      <div className="flex gap-2">
        <Link href="/dashboard">
          <Button>Dashboard</Button>
        </Link>
        <Link href="/">
          <Button variant="outline">Home</Button>
        </Link>
      </div>
    </div>
  )
}
