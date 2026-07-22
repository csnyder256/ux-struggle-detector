import { describe, it, expect } from 'vitest'
import {
  dispatchInterventions,
  dispatchInterventionsWithRows,
} from '@/lib/interventions/dispatcher'
import type { StruggleDetection } from '@/lib/types/events'
import type { ElementId } from '@/lib/types/ui-map'

const E1 = 'sh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as ElementId

function det(): StruggleDetection {
  return {
    sessionId: 'sess_1',
    elementId: E1,
    type: 'RAGE_CLICK',
    severity: 0.6,
    ts: '2026-05-01T12:00:00.000Z',
  }
}

describe('dispatcher - route denylist', () => {
  it('drops dispatch when the recent route is on the denylist', () => {
    const out = dispatchInterventions([det()], {
      safeMode: false,
      routeBySession: new Map([['sess_1', '/checkout']]),
      routeDenylist: ['/checkout'],
    })
    expect(out).toEqual([])
  })

  it('emits dispatch when the route is not on the denylist', () => {
    const out = dispatchInterventions([det()], {
      safeMode: false,
      routeBySession: new Map([['sess_1', '/dashboard']]),
      routeDenylist: ['/checkout'],
    })
    expect(out.length).toBe(1)
  })

  it('emits dispatch when the denylist is empty', () => {
    const out = dispatchInterventions([det()], {
      safeMode: false,
      routeBySession: new Map([['sess_1', '/checkout']]),
      routeDenylist: [],
    })
    expect(out.length).toBe(1)
  })

  it('emits dispatch when route map is missing the session', () => {
    const out = dispatchInterventions([det()], {
      safeMode: false,
      routeBySession: new Map(),
      routeDenylist: ['/checkout'],
    })
    expect(out.length).toBe(1)
  })

  it('rowId remains stable when route filters do not eliminate the dispatch', () => {
    const a = dispatchInterventionsWithRows([det()], {
      safeMode: false,
      routeBySession: new Map([['sess_1', '/dashboard']]),
      routeDenylist: ['/checkout'],
    })
    const b = dispatchInterventionsWithRows([det()], {
      safeMode: false,
      routeBySession: new Map([['sess_1', '/dashboard']]),
      routeDenylist: ['/admin'],
    })
    expect(a[0]?.rowId).toBe(b[0]?.rowId)
  })
})
