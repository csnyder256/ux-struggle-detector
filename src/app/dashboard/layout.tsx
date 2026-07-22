import Link from 'next/link'
import { signOut } from '@/lib/auth'
import { getCurrentOrg, isOpenAccessMode } from '@/lib/access'
import { Sidebar } from '@/components/dashboard/Sidebar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentOrg('/dashboard')
  const openMode = isOpenAccessMode()

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {ctx.userEmail ? (
              <>
                Signed in as <span className="font-medium text-foreground">{ctx.userEmail}</span>
              </>
            ) : (
              <>
                <Badge variant="outline">Open access</Badge>
                <span>
                  Demo workspace - sign-in disabled. Set <code className="font-mono">REQUIRE_AUTH=true</code>{' '}
                  to enable.
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/onboarding/direct">
              <Button variant="ghost" size="sm">
                Edit setup
              </Button>
            </Link>
            {openMode ? (
              <Link href="/">
                <Button variant="outline" size="sm">
                  Home
                </Button>
              </Link>
            ) : (
              <form
                action={async () => {
                  'use server'
                  await signOut({ redirectTo: '/' })
                }}
              >
                <Button variant="outline" size="sm" type="submit">
                  Sign out
                </Button>
              </form>
            )}
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
