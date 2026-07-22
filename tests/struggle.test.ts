import { describe, it, expect } from 'vitest'
import { detectStruggles } from '@/lib/struggle/detect'
import { EVENT_SCHEMA_VERSION, type RuntimeEvent } from '@/lib/types/events'
import type { ElementId } from '@/lib/types/ui-map'

const E1 = 'sh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as ElementId
const E2 = 'sh_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as ElementId

let counter = 0

function makeEvent(opts: Partial<RuntimeEvent> & { tsOffsetMs: number }): RuntimeEvent {
  counter++
  const base = new Date('2026-04-30T12:00:00.000Z').getTime()
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    idempotencyKey: `k${counter}`,
    sessionId: opts.sessionId ?? 'sess_1',
    userIdHash: null,
    elementId: opts.elementId ?? null,
    route: opts.route ?? '/checkout',
    eventType: opts.eventType ?? 'CLICK',
    ts: new Date(base + opts.tsOffsetMs).toISOString(),
  }
}

describe('detectStruggles - rage click', () => {
  it('fires when 3 clicks land on the same element within the window', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'CLICK', elementId: E1 }),
      makeEvent({ tsOffsetMs: 500, eventType: 'CLICK', elementId: E1 }),
      makeEvent({ tsOffsetMs: 1500, eventType: 'CLICK', elementId: E1 }),
    ]
    const result = detectStruggles(events)
    const rage = result.filter((d) => d.type === 'RAGE_CLICK')
    expect(rage.length).toBe(1)
    expect(rage[0]?.elementId).toBe(E1)
  })

  it('does not fire when clicks are spread across different elements', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'CLICK', elementId: E1 }),
      makeEvent({ tsOffsetMs: 500, eventType: 'CLICK', elementId: E2 }),
      makeEvent({ tsOffsetMs: 1500, eventType: 'CLICK', elementId: E1 }),
    ]
    const result = detectStruggles(events)
    expect(result.filter((d) => d.type === 'RAGE_CLICK').length).toBe(0)
  })

  it('does not fire when clicks are spaced beyond the window', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'CLICK', elementId: E1 }),
      makeEvent({ tsOffsetMs: 1500, eventType: 'CLICK', elementId: E1 }),
      makeEvent({ tsOffsetMs: 5000, eventType: 'CLICK', elementId: E1 }),
    ]
    const result = detectStruggles(events)
    expect(result.filter((d) => d.type === 'RAGE_CLICK').length).toBe(0)
  })

  it('emits at most one detection per (session, element, type)', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'CLICK', elementId: E1 }),
      makeEvent({ tsOffsetMs: 500, eventType: 'CLICK', elementId: E1 }),
      makeEvent({ tsOffsetMs: 1000, eventType: 'CLICK', elementId: E1 }),
      makeEvent({ tsOffsetMs: 1200, eventType: 'CLICK', elementId: E1 }),
      makeEvent({ tsOffsetMs: 1400, eventType: 'CLICK', elementId: E1 }),
      makeEvent({ tsOffsetMs: 1700, eventType: 'CLICK', elementId: E1 }),
    ]
    const result = detectStruggles(events)
    expect(result.filter((d) => d.type === 'RAGE_CLICK').length).toBe(1)
  })
})

describe('detectStruggles - rage click adapts to per-element baseline', () => {
  it('does NOT fire on a noisy element when 3 clicks-in-2s is normal there', () => {
    // Element historically gets ~3 clicks/sec; 3-clicks-in-2s threshold should
    // be raised to ~9 (3 cps * 2s * 1.5). Three clicks here are normal.
    const baselines = new Map([[E1 as string, { p95ClicksPerSec: 3, sampleSize: 50 }]])
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'CLICK', elementId: E1 }),
      makeEvent({ tsOffsetMs: 500, eventType: 'CLICK', elementId: E1 }),
      makeEvent({ tsOffsetMs: 1500, eventType: 'CLICK', elementId: E1 }),
    ]
    const result = detectStruggles(events, { baselines })
    expect(result.filter((d) => d.type === 'RAGE_CLICK').length).toBe(0)
  })

  it('still fires when click count clearly exceeds adapted threshold', () => {
    // Same noisy baseline, but 12 clicks in 2s - clearly rage even on a noisy
    // button.
    const baselines = new Map([[E1 as string, { p95ClicksPerSec: 3, sampleSize: 50 }]])
    const events: RuntimeEvent[] = []
    for (let i = 0; i < 12; i++) {
      events.push(makeEvent({ tsOffsetMs: i * 150, eventType: 'CLICK', elementId: E1 }))
    }
    const result = detectStruggles(events, { baselines })
    const rage = result.filter((d) => d.type === 'RAGE_CLICK')
    expect(rage.length).toBe(1)
    expect(rage[0]?.summary).toMatch(/adapted threshold/)
  })

  it('falls back to static threshold when baseline sampleSize is too small', () => {
    // Tiny sample (< 10) - baseline is ignored.
    const baselines = new Map([[E1 as string, { p95ClicksPerSec: 3, sampleSize: 5 }]])
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'CLICK', elementId: E1 }),
      makeEvent({ tsOffsetMs: 500, eventType: 'CLICK', elementId: E1 }),
      makeEvent({ tsOffsetMs: 1500, eventType: 'CLICK', elementId: E1 }),
    ]
    const result = detectStruggles(events, { baselines })
    expect(result.filter((d) => d.type === 'RAGE_CLICK').length).toBe(1)
  })

  it('uses adapted summary message when threshold was bumped', () => {
    const baselines = new Map([[E1 as string, { p95ClicksPerSec: 4, sampleSize: 50 }]])
    const events: RuntimeEvent[] = []
    for (let i = 0; i < 14; i++) {
      events.push(makeEvent({ tsOffsetMs: i * 100, eventType: 'CLICK', elementId: E1 }))
    }
    const result = detectStruggles(events, { baselines })
    const rage = result.filter((d) => d.type === 'RAGE_CLICK')
    expect(rage.length).toBe(1)
    expect(rage[0]?.summary).toContain('adapted threshold')
  })
})

describe('detectStruggles - LONG_DWELL adapts to per-element baseline', () => {
  it('does NOT fire when dwell time is normal for this element', () => {
    // Element's typical dwell is 90s (e.g. a docs page); 70s should NOT fire.
    const baselines = new Map([
      [E1 as string, { p95DwellMs: 90_000, sampleSize: 30 }],
    ])
    const events: RuntimeEvent[] = [
      makeEvent({
        tsOffsetMs: 0,
        eventType: 'DWELL',
        elementId: E1,
      }),
    ]
    // Inject ms via meta directly.
    events[0]!.meta = { ms: 70_000 }
    const result = detectStruggles(events, { baselines })
    expect(result.filter((d) => d.type === 'LONG_DWELL').length).toBe(0)
  })

  it('fires when dwell exceeds 1.5x baseline', () => {
    const baselines = new Map([
      [E1 as string, { p95DwellMs: 90_000, sampleSize: 30 }],
    ])
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'DWELL', elementId: E1 }),
    ]
    events[0]!.meta = { ms: 200_000 }
    const result = detectStruggles(events, { baselines })
    const ld = result.filter((d) => d.type === 'LONG_DWELL')
    expect(ld.length).toBe(1)
    expect(ld[0]?.summary).toMatch(/adapted threshold/)
  })

  it('falls back to static threshold when no baseline', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'DWELL', elementId: E1 }),
    ]
    events[0]!.meta = { ms: 70_000 }
    const result = detectStruggles(events)
    // Static threshold is 60s; 70s fires.
    expect(result.filter((d) => d.type === 'LONG_DWELL').length).toBe(1)
  })
})

describe('detectStruggles - loop', () => {
  it('fires when the same route is hit 3+ times in a session', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'NAVIGATION', route: '/checkout' }),
      makeEvent({ tsOffsetMs: 1000, eventType: 'NAVIGATION', route: '/cart' }),
      makeEvent({ tsOffsetMs: 2000, eventType: 'NAVIGATION', route: '/checkout' }),
      makeEvent({ tsOffsetMs: 3000, eventType: 'NAVIGATION', route: '/cart' }),
      makeEvent({ tsOffsetMs: 4000, eventType: 'NAVIGATION', route: '/checkout' }),
    ]
    const result = detectStruggles(events)
    const loops = result.filter((d) => d.type === 'LOOP')
    expect(loops.length).toBe(1)
  })

  it('does not fire on a normal forward flow', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'NAVIGATION', route: '/login' }),
      makeEvent({ tsOffsetMs: 1000, eventType: 'NAVIGATION', route: '/dashboard' }),
      makeEvent({ tsOffsetMs: 2000, eventType: 'NAVIGATION', route: '/settings' }),
    ]
    const result = detectStruggles(events)
    expect(result.filter((d) => d.type === 'LOOP').length).toBe(0)
  })
})

describe('detectStruggles - thrash', () => {
  it('fires when an input changes 5+ times in 4 seconds', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'INPUT_CHANGE', elementId: E1 }),
      makeEvent({ tsOffsetMs: 500, eventType: 'INPUT_CHANGE', elementId: E1 }),
      makeEvent({ tsOffsetMs: 1000, eventType: 'INPUT_CHANGE', elementId: E1 }),
      makeEvent({ tsOffsetMs: 2000, eventType: 'INPUT_CHANGE', elementId: E1 }),
      makeEvent({ tsOffsetMs: 3000, eventType: 'INPUT_CHANGE', elementId: E1 }),
    ]
    const result = detectStruggles(events)
    expect(result.filter((d) => d.type === 'THRASH').length).toBe(1)
  })

  it('does not fire for slow, deliberate input', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'INPUT_CHANGE', elementId: E1 }),
      makeEvent({ tsOffsetMs: 5000, eventType: 'INPUT_CHANGE', elementId: E1 }),
      makeEvent({ tsOffsetMs: 10000, eventType: 'INPUT_CHANGE', elementId: E1 }),
      makeEvent({ tsOffsetMs: 15000, eventType: 'INPUT_CHANGE', elementId: E1 }),
      makeEvent({ tsOffsetMs: 20000, eventType: 'INPUT_CHANGE', elementId: E1 }),
    ]
    const result = detectStruggles(events)
    expect(result.filter((d) => d.type === 'THRASH').length).toBe(0)
  })
})

describe('detectStruggles - silent fail', () => {
  it('fires when a SUBMIT has no follow-up event in the window', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'CLICK', elementId: E1 }),
      makeEvent({ tsOffsetMs: 500, eventType: 'SUBMIT', elementId: E1 }),
    ]
    const result = detectStruggles(events)
    expect(result.filter((d) => d.type === 'SILENT_FAIL').length).toBe(1)
  })

  it('does not fire when the user navigates after submitting', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'SUBMIT', elementId: E1 }),
      makeEvent({ tsOffsetMs: 500, eventType: 'NAVIGATION', route: '/success' }),
    ]
    const result = detectStruggles(events)
    expect(result.filter((d) => d.type === 'SILENT_FAIL').length).toBe(0)
  })
})

describe('detectStruggles - empty input', () => {
  it('returns no detections for an empty event array', () => {
    expect(detectStruggles([])).toEqual([])
  })
})

// ─── New rule coverage ───────────────────────────────────────────────────────

describe('detectStruggles - dead click', () => {
  it('fires when SDK marks meta.dead = true', () => {
    const e = makeEvent({ tsOffsetMs: 0, eventType: 'CLICK', elementId: E1 })
    e.meta = { dead: true }
    const r = detectStruggles([e])
    expect(r.find((d) => d.type === 'DEAD_CLICK')?.elementId).toBe(E1)
  })
})

describe('detectStruggles - invalid click', () => {
  it('fires when SDK marks meta.disabled = true', () => {
    const e = makeEvent({ tsOffsetMs: 0, eventType: 'CLICK', elementId: E1 })
    e.meta = { disabled: true }
    expect(detectStruggles([e]).some((d) => d.type === 'INVALID_CLICK')).toBe(true)
  })
})

describe('detectStruggles - validation loop', () => {
  it('fires after multiple submit / validation_error cycles', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'SUBMIT', elementId: E1 }),
      makeEvent({ tsOffsetMs: 100, eventType: 'VALIDATION_ERROR', elementId: E1 }),
      makeEvent({ tsOffsetMs: 1000, eventType: 'SUBMIT', elementId: E1 }),
      makeEvent({ tsOffsetMs: 1100, eventType: 'VALIDATION_ERROR', elementId: E1 }),
    ]
    expect(detectStruggles(events).some((d) => d.type === 'VALIDATION_LOOP')).toBe(true)
  })
})

describe('detectStruggles - hover hunt', () => {
  it('fires when many hovers happen in a window without a click', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'HOVER', elementId: E1 }),
      makeEvent({ tsOffsetMs: 200, eventType: 'HOVER', elementId: E2 }),
      makeEvent({ tsOffsetMs: 400, eventType: 'HOVER', elementId: E1 }),
      makeEvent({ tsOffsetMs: 800, eventType: 'HOVER', elementId: E2 }),
      makeEvent({ tsOffsetMs: 1500, eventType: 'HOVER', elementId: E1 }),
      makeEvent({ tsOffsetMs: 2200, eventType: 'HOVER', elementId: E2 }),
    ]
    expect(detectStruggles(events).some((d) => d.type === 'HOVER_HUNT')).toBe(true)
  })

  it('does not fire when a click follows', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'HOVER', elementId: E1 }),
      makeEvent({ tsOffsetMs: 200, eventType: 'HOVER', elementId: E2 }),
      makeEvent({ tsOffsetMs: 400, eventType: 'HOVER', elementId: E1 }),
      makeEvent({ tsOffsetMs: 800, eventType: 'HOVER', elementId: E2 }),
      makeEvent({ tsOffsetMs: 1500, eventType: 'HOVER', elementId: E1 }),
      makeEvent({ tsOffsetMs: 2200, eventType: 'HOVER', elementId: E2 }),
      makeEvent({ tsOffsetMs: 2400, eventType: 'CLICK', elementId: E2 }),
    ]
    expect(detectStruggles(events).some((d) => d.type === 'HOVER_HUNT')).toBe(false)
  })
})

describe('detectStruggles - long dwell', () => {
  it('fires when a DWELL event reports > 30s of inactivity', () => {
    const e = makeEvent({ tsOffsetMs: 0, eventType: 'DWELL', elementId: E1 })
    e.meta = { ms: 35_000 }
    expect(detectStruggles([e]).some((d) => d.type === 'LONG_DWELL')).toBe(true)
  })
})

describe('detectStruggles - js error', () => {
  it('fires immediately on a JS_ERROR event', () => {
    const e = makeEvent({ tsOffsetMs: 0, eventType: 'JS_ERROR' })
    e.meta = { message: 'TypeError: x is not a function' }
    const r = detectStruggles([e])
    expect(r.find((d) => d.type === 'JS_ERROR')?.summary).toContain('TypeError')
  })
})

describe('detectStruggles - quick bounce', () => {
  it('fires when consecutive navigations happen within the dwell window', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'NAVIGATION', route: '/a' }),
      makeEvent({ tsOffsetMs: 800, eventType: 'NAVIGATION', route: '/b' }),
    ]
    expect(detectStruggles(events).some((d) => d.type === 'QUICK_BOUNCE')).toBe(true)
  })
})

describe('detectStruggles - circular nav', () => {
  it('fires on A→B→A→B alternation', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'NAVIGATION', route: '/a' }),
      makeEvent({ tsOffsetMs: 1000, eventType: 'NAVIGATION', route: '/b' }),
      makeEvent({ tsOffsetMs: 2000, eventType: 'NAVIGATION', route: '/a' }),
      makeEvent({ tsOffsetMs: 3000, eventType: 'NAVIGATION', route: '/b' }),
      makeEvent({ tsOffsetMs: 4000, eventType: 'NAVIGATION', route: '/a' }),
      makeEvent({ tsOffsetMs: 5000, eventType: 'NAVIGATION', route: '/b' }),
    ]
    expect(detectStruggles(events).some((d) => d.type === 'CIRCULAR_NAV')).toBe(true)
  })
})

describe('detectStruggles - paste repeat', () => {
  it('fires after multiple pastes on same element', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'PASTE', elementId: E1 }),
      makeEvent({ tsOffsetMs: 1000, eventType: 'PASTE', elementId: E1 }),
    ]
    expect(detectStruggles(events).some((d) => d.type === 'PASTE_REPEAT')).toBe(true)
  })
})

describe('detectStruggles - locked out', () => {
  it('fires after 5+ login validation errors', () => {
    const events: RuntimeEvent[] = []
    for (let i = 0; i < 5; i++) {
      const e = makeEvent({ tsOffsetMs: i * 1000, eventType: 'VALIDATION_ERROR', elementId: E1 })
      e.meta = { kind: 'login' }
      events.push(e)
    }
    const r = detectStruggles(events)
    expect(r.some((d) => d.type === 'LOCKED_OUT')).toBe(true)
    expect(r.some((d) => d.type === 'PASSWORD_RETRY')).toBe(true)
  })
})

describe('detectStruggles - zero results', () => {
  it('fires when search submit reports results=0', () => {
    const e = makeEvent({ tsOffsetMs: 0, eventType: 'SUBMIT', elementId: E1 })
    e.meta = { kind: 'search', results: 0 }
    expect(detectStruggles([e]).some((d) => d.type === 'ZERO_RESULTS')).toBe(true)
  })
})

describe('detectStruggles - 404 bounce', () => {
  it('fires when /404 navigation is followed by another nav within 3s', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'NAVIGATION', route: '/404' }),
      makeEvent({ tsOffsetMs: 2000, eventType: 'NAVIGATION', route: '/' }),
    ]
    expect(detectStruggles(events).some((d) => d.type === 'NOT_FOUND_BOUNCE')).toBe(true)
  })
})

describe('detectStruggles - copy bounce', () => {
  it('fires when copy is followed by navigation within 5s', () => {
    const events: RuntimeEvent[] = [
      makeEvent({ tsOffsetMs: 0, eventType: 'COPY', elementId: E1 }),
      makeEvent({ tsOffsetMs: 2000, eventType: 'NAVIGATION', route: '/elsewhere' }),
    ]
    expect(detectStruggles(events).some((d) => d.type === 'COPY_BOUNCE')).toBe(true)
  })
})

describe('detectStruggles - help hunt', () => {
  it('fires on a click with role=help', () => {
    const e = makeEvent({ tsOffsetMs: 0, eventType: 'CLICK', elementId: E1 })
    e.meta = { role: 'help' }
    expect(detectStruggles([e]).some((d) => d.type === 'HELP_HUNT')).toBe(true)
  })
})
