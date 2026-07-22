/**
 * Batched transport - POSTs the buffer to /api/events with retry-via-rebuffer
 * on failure. Uses `keepalive: true` so an in-flight request survives navigation.
 *
 * The /api/events response includes server-dispatched interventions; we
 * forward those to the renderer via the callback supplied at construction.
 */

import {
  EVENT_SCHEMA_VERSION,
  type DispatchedIntervention,
  type EventBatchRequest,
  type EventBatchResponse,
} from '../lib/types/events'
import type { EventBuffer } from './event-buffer'

export interface FlushResult {
  sent: number
  error?: string
  interventions?: DispatchedIntervention[]
}

export type InterventionHandler = (interventions: DispatchedIntervention[]) => void

export class Transport {
  constructor(
    private readonly orgId: string,
    private readonly endpoint: string,
    private readonly buffer: EventBuffer,
    private readonly clockOffsetMs: number = 0,
    private readonly onInterventions?: InterventionHandler,
    private readonly ingestKey?: string,
  ) {}

  async flush(): Promise<FlushResult> {
    const events = this.buffer.drain()
    if (events.length === 0) return { sent: 0 }

    const body: EventBatchRequest = {
      schemaVersion: EVENT_SCHEMA_VERSION,
      clockOffsetMs: this.clockOffsetMs,
      events,
    }

    if (this.endpoint === 'console') {
      // eslint-disable-next-line no-console
      console.log('[clarus-heal] flush', body)
      return { sent: events.length }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Org-Id': this.orgId,
    }
    if (this.ingestKey) headers['Authorization'] = `Bearer ${this.ingestKey}`
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        keepalive: true,
      })
      if (!res.ok) {
        for (const e of events) this.buffer.push(e)
        return { sent: 0, error: `HTTP ${res.status}` }
      }
      let response: EventBatchResponse | null = null
      try {
        response = (await res.json()) as EventBatchResponse
      } catch {
        // malformed response - still consider events sent
      }
      const interventions = response?.interventions ?? []
      if (interventions.length > 0 && this.onInterventions) {
        try {
          this.onInterventions(interventions)
        } catch {
          // renderer threw - don't block transport
        }
      }
      return { sent: events.length, interventions }
    } catch (err) {
      for (const e of events) this.buffer.push(e)
      return { sent: 0, error: (err as Error).message }
    }
  }
}
