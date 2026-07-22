/**
 * Bounded localStorage queue. Drops oldest events when the bound is hit so
 * the SDK can never grow memory unboundedly even if the customer's network
 * is offline for a long time.
 */

import type { RuntimeEvent } from '../lib/types/events'

const STORAGE_KEY = '__sh_buf_v1__'
const MAX_BUFFERED = 200

export class EventBuffer {
  private inMem: RuntimeEvent[] = []

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) this.inMem = parsed
      }
    } catch {
      this.inMem = []
    }
  }

  push(e: RuntimeEvent): void {
    this.inMem.push(e)
    if (this.inMem.length > MAX_BUFFERED) {
      this.inMem = this.inMem.slice(-MAX_BUFFERED)
    }
    this.persist()
  }

  drain(): RuntimeEvent[] {
    const out = this.inMem
    this.inMem = []
    this.persist()
    return out
  }

  size(): number {
    return this.inMem.length
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.inMem))
    } catch {
      // Quota exceeded or storage disabled - keep going in-memory.
    }
  }
}
