import Link from 'next/link'
import { Activity, Mail } from 'lucide-react'

export default function VerifyRequestPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 font-semibold">
          <Activity className="h-5 w-5" />
          <span>Clarus Heal</span>
        </Link>
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full border bg-muted/30">
          <Mail className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          We&rsquo;ve sent you a sign-in link. It&rsquo;s good for the next 24 hours and only works once.
        </p>
        <p className="mt-6 text-xs text-muted-foreground">
          Didn&rsquo;t get it? Check spam, or{' '}
          <Link href="/sign-in" className="underline">
            request a new link
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
