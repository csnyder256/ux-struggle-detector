'use client'

import * as React from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface SdkSnippetProps {
  baseUrl: string
  orgId: string
  /** Override the default endpoint path. */
  endpoint?: string
  /** Optional bearer ingest key. When present the snippet wires it in. */
  ingestKey?: string
  /**
   * Saved sampling config (from /dashboard/settings). When non-empty we
   * generate the manual-init form of the snippet so the JS object can carry
   * the per-type rates.
   */
  samplingConfig?: { default?: number; byType?: Record<string, number> }
  className?: string
}

export function SdkSnippet({
  baseUrl,
  orgId,
  endpoint,
  ingestKey,
  samplingConfig,
  className,
}: SdkSnippetProps) {
  const eventsEndpoint = `${baseUrl}/api/events`
  const sdkScript = `${baseUrl}/sdk.min.js`
  const hasSampling =
    samplingConfig &&
    ((typeof samplingConfig.default === 'number' && samplingConfig.default !== 1) ||
      (samplingConfig.byType && Object.keys(samplingConfig.byType).length > 0))

  // When sampling is configured we use the manual-init form (object literal
  // can carry the sampling object). Otherwise: tiny one-tag auto-init.
  let snippet: string
  if (hasSampling) {
    const initOpts: Record<string, unknown> = {
      orgId,
      endpoint: endpoint ?? eventsEndpoint,
      ...(ingestKey ? { ingestKey } : {}),
      sampling: samplingConfig,
    }
    snippet = `<script src="${sdkScript}"></script>
<script>
  ClarusHeal.initSelfHealing(${JSON.stringify(initOpts, null, 2)})
</script>`
  } else {
    const dataAttrs = [
      `data-org-id=${JSON.stringify(orgId)}`,
      ingestKey ? `data-ingest-key=${JSON.stringify(ingestKey)}` : '',
      endpoint
        ? `data-endpoint=${JSON.stringify(endpoint)}`
        : `data-endpoint=${JSON.stringify(eventsEndpoint)}`,
    ]
      .filter(Boolean)
      .join(' ')
    snippet = `<script src="${sdkScript}" ${dataAttrs}></script>`
  }

  const [copied, setCopied] = React.useState(false)
  function copy() {
    navigator.clipboard
      .writeText(snippet)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      })
      .catch(() => {
        // ignore - older browsers
      })
  }

  return (
    <div className={cn('group relative', className)}>
      <pre className="overflow-x-auto rounded-md border bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-100">
        <code>{snippet}</code>
      </pre>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="absolute right-2 top-2 bg-background/95 backdrop-blur"
        onClick={copy}
      >
        {copied ? (
          <>
            <Check className="h-3 w-3" />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" />
            Copy
          </>
        )}
      </Button>
    </div>
  )
}
