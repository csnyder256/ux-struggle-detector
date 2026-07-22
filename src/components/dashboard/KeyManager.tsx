import Link from 'next/link'
import { Brain, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { maskedDisplay } from '@/lib/crypto/keys'

export interface KeyManagerProps {
  deep:
    | { provider: string; lastFour: string; rotatedAt: Date | null; createdAt: Date }
    | null
  fast:
    | { provider: string; lastFour: string; rotatedAt: Date | null; createdAt: Date }
    | null
}

const PROVIDER_LABEL: Record<string, string> = {
  ANTHROPIC: 'Anthropic (Claude)',
  OPENAI: 'OpenAI (GPT)',
  GOOGLE: 'Google',
  CUSTOM: 'Custom',
}

export function KeyManager({ deep, fast }: KeyManagerProps) {
  return (
    <div className="space-y-6">
      <KeyRow
        icon={<Brain className="h-4 w-4" />}
        label="Deep analysis key"
        sublabel="Used during platform mapping. Slow, structured-JSON output."
        keyData={deep}
      />
      <KeyRow
        icon={<Zap className="h-4 w-4" />}
        label="Fast response key"
        sublabel="Used at runtime when a user struggles. Sub-second responses."
        keyData={fast}
      />
      <div className="flex justify-end">
        <Link href="/onboarding/direct/keys">
          <Button variant="outline" size="sm">
            Rotate or change provider
          </Button>
        </Link>
      </div>
    </div>
  )
}

function KeyRow({
  icon,
  label,
  sublabel,
  keyData,
}: {
  icon: React.ReactNode
  label: string
  sublabel: string
  keyData: KeyManagerProps['deep']
}) {
  return (
    <div className="flex items-start gap-4 rounded-md border p-4">
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted/30">
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium">{label}</p>
          {keyData ? (
            <Badge variant="secondary">
              {PROVIDER_LABEL[keyData.provider] ?? keyData.provider}
            </Badge>
          ) : (
            <Badge variant="outline">Not configured</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{sublabel}</p>
        <p className="mt-2 font-mono text-sm">
          {keyData ? maskedDisplay(keyData.lastFour) : ' - '}
        </p>
        {keyData?.rotatedAt ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Last rotated {keyData.rotatedAt.toISOString().slice(0, 10)}
          </p>
        ) : null}
      </div>
    </div>
  )
}
