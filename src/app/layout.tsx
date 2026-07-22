import type { Metadata } from 'next'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'Clarus Heal - Self-Healing UX',
  description:
    'A codebase-aware, runtime-aware adaptive layer that maps your UI, infers user intent, detects struggle patterns, and surfaces "Looks like you\'re trying to ___" interventions live.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">{children}</body>
    </html>
  )
}
