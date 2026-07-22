import { Activity } from 'lucide-react'

export function Footer() {
  return (
    <footer className="border-t bg-muted/20">
      <div className="container mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 py-10 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4" />
          <span className="font-medium text-foreground">Clarus Heal</span>
          <span> - </span>
          <span>Self-healing UX for shipped apps.</span>
        </div>
        <div className="flex gap-4">
          <span>Privacy-first by default</span>
          <span>·</span>
          <span>SOC 2 in progress</span>
        </div>
      </div>
    </footer>
  )
}
