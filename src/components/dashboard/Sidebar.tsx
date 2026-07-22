'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  AlertTriangle,
  Code2,
  FolderTree,
  GitBranch,
  History,
  LayoutDashboard,
  MousePointerClick,
  Receipt,
  Settings,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/install', label: 'SDK', icon: Code2 },
  { href: '/dashboard/repos', label: 'Repos', icon: FolderTree },
  { href: '/dashboard/flows', label: 'Flow Map', icon: GitBranch },
  { href: '/dashboard/friction', label: 'Friction Points', icon: AlertTriangle },
  { href: '/dashboard/elements', label: 'Element Breakdown', icon: MousePointerClick },
  { href: '/dashboard/interventions', label: 'Interventions', icon: Sparkles },
  { href: '/dashboard/sessions', label: 'Sessions', icon: History },
  { href: '/dashboard/usage', label: 'Usage', icon: Receipt },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
] as const

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-muted/20 md:block">
      <div className="flex h-14 items-center border-b px-5">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
          <Activity className="h-5 w-5" />
          <span>Clarus Heal</span>
        </Link>
      </div>
      <nav className="flex flex-col gap-1 p-3">
        {NAV.map((item) => {
          const active =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
