/**
 * SDK -> backend dwell attribution.
 *
 * A DWELL event is only useful if it names the element the user was actually
 * stuck on, because the server keys two things on that element id: the
 * per-element `p95DwellMs` baseline that raises `LONG_DWELL`'s threshold, and
 * the intervention the dispatcher anchors to the struggle. A dwell naming the
 * wrong element does not merely mislabel a row - it raises the threshold on a
 * *different* element than the one being stared at, so the rule that should
 * have fired did not, and the hint that did fire lands on the wrong thing.
 *
 * These tests drive the real SDK against a real jsdom document, capture the
 * events it really emitted, and hand those to the real server detector. Nothing
 * here re-implements the SDK's scheduling or the detector's rules; a copy of
 * either would pass while the real page did something else.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import {
  bootSdk,
  tick,
  typeInto,
  click,
  dwellEvents,
  eventsOf,
  moveMouse,
  hoverOver,
  detect,
  type SdkRun,
} from './helpers/sdk-browser'
import type { ElementId } from '@/lib/types/ui-map'
import type { RuntimeEvent } from '@/lib/types/events'

let run: SdkRun | null = null

beforeEach(() => {
  run = null
})

afterEach(() => {
  run?.stop()
  run = null
})

/**
 * Idle until the SDK has actually reported `targets` DWELL events.
 *
 * Waiting on the observable report count rather than on elapsed virtual time
 * makes these tests depend on the SDK's behaviour instead of on how many
 * one-second wake-ups the scheduler happened to deliver.
 */
async function idleUntilReports(sdk: SdkRun, targets: number, maxMs = 200_000): Promise<void> {
  for (let elapsed = 0; elapsed < maxMs; elapsed += 1_000) {
    if (dwellEvents(sdk.events).length >= targets) return
    await tick(1_000)
  }
}

/** The id the SDK itself would resolve for an element, so the test never guesses. */
async function elementIdFor(el: Element): Promise<ElementId> {
  const { resolveElementId } = await import('@/sdk/element-id')
  return resolveElementId('org_test', el)
}

describe('DWELL attribution', () => {
  it('names the element that was typed into, not whatever the pointer rests on', async () => {
    run = await bootSdk(
      '<div id="filler">Marketing copy nobody interacted with</div>' +
        '<form><input id="tax" /><button id="save">Save</button></form>',
    )
    const tax = run.doc.getElementById('tax') as HTMLInputElement
    const filler = run.doc.getElementById('filler')!
    const taxId = await elementIdFor(tax)

    // The user types, then stops to think. The pointer happens to be over the
    // filler block, so a hover-only tracker names *that* instead.
    typeInto(tax, '12-3456789')
    await tick(1_000)
    moveMouse(filler)
    await tick(500)

    await idleUntilReports(run, 2)

    const dwell = dwellEvents(run.events)
    expect(dwell.length).toBeGreaterThan(0)
    expect(dwell[0]?.elementId, 'DWELL names the field the user typed into').toBe(taxId)
    expect(
      dwell.every((e: RuntimeEvent) => e.elementId === taxId),
      'every report in the stretch names the same element',
    ).toBe(true)
  })

  it('does not let a pointer crossing the page steal the attribution', async () => {
    run = await bootSdk(
      '<div id="sidebar">Navigation</div>' +
        '<div id="canvas"><button id="cta">Continue</button></div>',
    )
    const cta = run.doc.getElementById('cta')!
    const sidebar = run.doc.getElementById('sidebar')!
    const ctaId = await elementIdFor(cta)

    click(cta)
    await tick(1_000)

    // A hover is the weakest possible evidence for what a dwell is about, and
    // the SDK only promotes one when a report is actually due - so a mouse
    // gliding across the page while a click was the last real interaction
    // cannot reassign the quiet stretch.
    await idleUntilReports(run, 1)
    moveMouse(sidebar)
    await tick(5_000)

    const dwell = dwellEvents(run.events)
    expect(dwell.length).toBeGreaterThan(0)
    expect(dwell.every((e: RuntimeEvent) => e.elementId === ctaId)).toBe(true)
  })

  it('still names the element a hover was left on when nothing else happened', async () => {
    run = await bootSdk('<div id="hero"><button id="guide">Open guide</button></div>')
    const guide = run.doc.getElementById('guide')!
    const guideId = await elementIdFor(guide)

    // Nothing but a hover: the pointer is the only evidence there is, so it is
    // used rather than thrown away. A `mouseover` is what the SDK turns into a
    // HOVER event, and a `mousemove` is what keeps the quiet timer alive - a
    // real visitor produces both.
    hoverOver(guide)
    moveMouse(guide)
    await idleUntilReports(run, 2)

    const dwell = dwellEvents(run.events)
    expect(dwell.length).toBeGreaterThan(0)
    expect(dwell[0]?.elementId).toBe(guideId)
  })

  it('carries the named element far enough to reach an adapted threshold', async () => {
    run = await bootSdk('<form><input id="tax" /><button id="save">Save</button></form>')
    const tax = run.doc.getElementById('tax') as HTMLInputElement
    const taxId = await elementIdFor(tax)

    typeInto(tax, '12')
    await tick(1_000)
    await idleUntilReports(run, 111)

    const dwell = dwellEvents(run.events)
    expect(dwell[0]?.elementId).toBe(taxId)

    // This element's own p95 says 30s of quiet is normal for it, so LONG_DWELL
    // is raised to max(30s, 30s * 1.5) = 45s for this element alone. The report
    // that clears that bar has to be attributed to the same element, or the
    // adapted threshold applies to a field the user never sat on.
    const baselines = new Map([[taxId as string, { p95DwellMs: 30_000, sampleSize: 30 }]])
    const dets = detect(run.events, baselines).filter((d) => d.type === 'LONG_DWELL')
    expect(dets).toHaveLength(1)
    expect(dets[0]?.elementId).toBe(taxId)
    expect(dets[0]?.summary).toMatch(/adapted threshold/)
    const longest = Math.max(...dwell.map((e: RuntimeEvent) => Number(e.meta?.ms ?? 0)))
    expect(longest).toBeGreaterThanOrEqual(45_000 - 1_000)
  })

  it('does not raise the adapted threshold on the element the pointer happened to rest on', async () => {
    run = await bootSdk(
      '<div id="filler">Copy</div><form><input id="tax" /><button id="save">Save</button></form>',
    )
    const tax = run.doc.getElementById('tax') as HTMLInputElement
    const filler = run.doc.getElementById('filler')!
    const taxId = await elementIdFor(tax)
    const fillerId = await elementIdFor(filler)

    typeInto(tax, '12')
    await tick(1_000)
    moveMouse(filler)
    await tick(500)
    await idleUntilReports(run, 111)

    // A baseline the *filler* block earned from being hovered must not be the
    // one that decides whether the tax field is stuck. Both baselines are
    // supplied, and only the field's own may hold the report back.
    const baselines = new Map([
      [taxId as string, { p95DwellMs: 30_000, sampleSize: 30 }],
      [fillerId as string, { p95DwellMs: 600_000, sampleSize: 30 }],
    ])
    const dets = detect(run.events, baselines).filter((d) => d.type === 'LONG_DWELL')
    expect(dets).toHaveLength(1)
    expect(dets[0]?.elementId).toBe(taxId)
    expect(dets[0]?.summary).toMatch(/45s/)
  })

  it('emits HOVER with no element id, so a hover is not read as an interaction with the element', async () => {
    run = await bootSdk('<div id="panel"><button id="cta">Continue</button></div>')
    hoverOver(run.doc.getElementById('cta')!)
    await tick(1_000)

    const hovers = eventsOf(run.events, 'HOVER')
    expect(hovers.length).toBeGreaterThan(0)
    // Hovers feed the per-element "hovers before the first click" baseline. A
    // hover carrying an element id would be indistinguishable from a real
    // interaction with that element in the stored events, so the SDK keeps the
    // id off the event and holds it only for the dwell it might name.
    expect(hovers.every((e: RuntimeEvent) => e.elementId === null)).toBe(true)
  })
})
