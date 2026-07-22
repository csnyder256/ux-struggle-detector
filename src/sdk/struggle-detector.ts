/**
 * Local rage-click detector. Keeps a rolling window of recent clicks per
 * element; if the threshold is exceeded the SDK can fire a local intervention
 * before the server has weighed in. The server-side struggle detector
 * (Phase 6) is the system of record - this is just a fast local trigger.
 */

import { DEFAULT_STRUGGLE_RULES } from '../lib/types/events'
import type { ElementId } from '../lib/types/ui-map'

export type DetectorResult =
  | { detected: false }
  | { detected: true; type: 'RAGE_CLICK'; elementId: ElementId | null }

export class RageClickDetector {
  private clicks: Array<{ elementId: ElementId | null; ts: number }> = []

  observe(elementId: ElementId | null): DetectorResult {
    const now = Date.now()
    const cutoff = now - DEFAULT_STRUGGLE_RULES.rageClick.windowMs
    this.clicks = this.clicks.filter((c) => c.ts >= cutoff)
    this.clicks.push({ elementId, ts: now })

    const onSame = this.clicks.filter((c) => c.elementId === elementId)
    if (onSame.length >= DEFAULT_STRUGGLE_RULES.rageClick.minClicks) {
      this.clicks = []
      return { detected: true, type: 'RAGE_CLICK', elementId }
    }
    return { detected: false }
  }
}
