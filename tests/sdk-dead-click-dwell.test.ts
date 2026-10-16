import { describe, it, expect } from 'vitest'
import { bootSdk, click, tick } from './helpers/sdk-dom'
import { detectStruggles } from '@/lib/struggle/detect'
import { dispatchInterventions } from '@/lib/interventions/dispatcher'
import { DEFAULT_STRUGGLE_RULES, type RuntimeEvent } from '@/lib/types/events'

/**
 * DEAD_CLICK against the REAL SDK.
 *
 * `hasHandler` in `src/sdk/index.ts` marks a click `dead` whenever the element
 * it resolved has no handler - which is every decorative element, every image
 * and the page background, not just a broken control. The declared rule
 * (`DEFAULT_STRUGGLE_RULES.deadClick`) only fires when the user then *dwells*
 * on the page for `dwellMs` without navigating, and these tests pin that
 * contract on events the SDK actually emits, because the false positive it
 * prevents is user-visible: DEAD_CLICK dispatches the "That's not clickable -
 * try the highlighted control instead" tooltip at high confidence.
 */

const PAGE = `
  <div id="card" class="card">Quarterly revenue</div>
  <button id="buy">Buy</button>
`

const dwellMs = DEFAULT_STRUGGLE_RULES.deadClick.dwellMs

function clicks(events: RuntimeEvent[]): RuntimeEvent[] {
  return events.filter((e) => e.eventType === 'CLICK')
}

function pushedNav(events: RuntimeEvent[]): RuntimeEvent[] {
  return events.filter((e) => e.eventType === 'NAVIGATION' && e.meta?.trigger === 'pushstate')
}

function deadClicks(dets: ReturnType<typeof detectStruggles>) {
  return dets.filter((d) => d.type === 'DEAD_CLICK')
}

describe('DEAD_CLICK dwell gate, driven by the real SDK', () => {
  it('the SDK really marks a click on a decorative element dead', async () => {
    const run = await bootSdk(PAGE)
    try {
      click(run.doc.getElementById('card')!)
      await run.settle()
      const observed = clicks(run.events)
      expect(observed).toHaveLength(1)
      expect(observed[0]?.meta?.dead).toBe(true)
    } finally {
      run.stop()
    }
  })

  it('does not report (or dispatch anything for) a click the user walked away from', async () => {
    const run = await bootSdk(PAGE)
    try {
      click(run.doc.getElementById('card')!)
      await run.settle()
      // Navigate 200ms later - inside the dwell window - then keep working on
      // the next page, so the session does hold later events.
      await tick(200)
      run.win.history.pushState({}, '', '/next')
      await run.settle()
      await tick(dwellMs + 500)
      click(run.doc.getElementById('buy')!)
      await run.settle()

      // The scenario is real: a dead-marked click, a navigation inside the
      // window, and a later event proving the session continued.
      expect(clicks(run.events)[0]?.meta?.dead).toBe(true)
      expect(pushedNav(run.events)).toHaveLength(1)
      const navAt = Date.parse(pushedNav(run.events)[0]!.ts)
      const clickAt = Date.parse(clicks(run.events)[0]!.ts)
      expect(navAt - clickAt).toBeLessThanOrEqual(dwellMs)
      expect(Date.parse(clicks(run.events)[1]!.ts) - clickAt).toBeGreaterThan(dwellMs)

      const dets = detectStruggles(run.events)
      expect(deadClicks(dets)).toHaveLength(0)
      // ...and the user-visible consequence: the "not clickable" tooltip is
      // not dispatched for a click they already left behind.
      const dispatched = dispatchInterventions(dets, { safeMode: false })
      expect(dispatched.some((d) => /not clickable/i.test(d.copy))).toBe(false)
    } finally {
      run.stop()
    }
  })

  it('still reports the dead click, and the tooltip, for a user who stays put', async () => {
    const run = await bootSdk(PAGE)
    try {
      click(run.doc.getElementById('card')!)
      await run.settle()
      await tick(dwellMs + 500)
      click(run.doc.getElementById('buy')!)
      await run.settle()

      const dets = detectStruggles(run.events)
      expect(deadClicks(dets)).toHaveLength(1)

      const dispatched = dispatchInterventions(dets, { safeMode: false })
      expect(dispatched.some((d) => d.type === 'TOOLTIP' && /not clickable/i.test(d.copy))).toBe(true)
    } finally {
      run.stop()
    }
  })
})
