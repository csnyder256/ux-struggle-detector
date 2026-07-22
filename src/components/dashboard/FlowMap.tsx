'use client'

import { ResponsiveContainer, Sankey, Tooltip } from 'recharts'

export interface FlowMapNode {
  name: string
}

export interface FlowMapLink {
  source: number
  target: number
  value: number
}

export interface FlowMapProps {
  nodes: FlowMapNode[]
  links: FlowMapLink[]
}

export function FlowMap({ nodes, links }: FlowMapProps) {
  if (nodes.length === 0 || links.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center rounded-md border border-dashed text-center text-sm text-muted-foreground">
        Once your SDK is reporting events, your top route flows will appear here as a Sankey.
      </div>
    )
  }
  return (
    <div className="h-[480px] rounded-md border bg-card p-4">
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={{ nodes, links }}
          nodePadding={20}
          margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
          link={{ stroke: '#94a3b8' }}
        >
          <Tooltip />
        </Sankey>
      </ResponsiveContainer>
    </div>
  )
}
