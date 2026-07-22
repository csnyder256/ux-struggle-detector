import Link from 'next/link'
import { Activity } from 'lucide-react'
import { signIn } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<{ callbackUrl?: string; error?: string }>
}) {
  const params = (await searchParams) ?? {}
  const callbackUrl = params.callbackUrl ?? '/dashboard'

  async function sendMagicLink(formData: FormData) {
    'use server'
    const email = String(formData.get('email') ?? '').trim()
    if (!email) return
    await signIn('nodemailer', { email, redirectTo: callbackUrl })
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center gap-2 font-semibold">
          <Activity className="h-5 w-5" />
          <span>Clarus Heal</span>
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We&rsquo;ll email you a magic link. No password.
        </p>
        {params.error ? (
          <p className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            Sign-in failed. Check your inbox or try again.
          </p>
        ) : null}
        <form action={sendMagicLink} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoFocus placeholder="you@company.com" />
          </div>
          <Button type="submit" className="w-full">
            Send magic link
          </Button>
        </form>
        <p className="mt-6 text-xs text-muted-foreground">
          By signing in, you agree to our terms.{' '}
          <Link href="/" className="underline">
            Back to home
          </Link>
        </p>
      </div>
    </div>
  )
}
