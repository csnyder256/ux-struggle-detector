/**
 * The pointer position on a click, captured through the REAL SDK.
 *
 * The server's mis-click rule is defined as two clicks inside its interval
 * *with the cursor moving N pixels*, so the detector can only honour it if the
 * SDK actually sends where each click landed. These tests drive the real SDK
 * against a live jsdom document and assert on the events it emits - nothing
 * here re-implements the capture.
 *
 * jsdom is a DOM implementation, not a browser: it carries `clientX`/`clientY`
 * through `MouseEvent`, which is the same channel the browser uses, but this is
 * not a claim about browser behaviour beyond that.
 */

import { describe, it, expect } from 'vitest'
import type { RuntimeEvent } from '@/lib/types/events'
import { bootSdk, click, eventsOf } from './helpers/sdk-dom'

/** Let the SDK's async emit chain settle until a matching event has landed. */
async function settleUntil(
  run: { events: RuntimeEvent[]; settle: () => Promise<unknown> },
  pred: (e: RuntimeEvent) => boolean,
  maxTicks = 40,
): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    await run.settle()
    if (run.events.some(pred)) return
    const { tick } = await import('./helpers/sdk-dom')
    await tick(1_000)
  }
}

describe('SDK click coordinates', () => {
  it('reports where the pointer was on a click the rule can measure', async () => {
    const run = await bootSdk('<button id="save">Save</button>')
    try {
      const button = run.doc.getElementById('save')!
      click(button, { clientX: 312, clientY: 208 })
      await settleUntil(run, (e) => e.eventType === 'CLICK')

      const clicks = eventsOf(run.events, 'CLICK')
      expect(clicks.length).toBe(1)
      expect(clicks[0]!.meta?.x).toBe(312)
      expect(clicks[0]!.meta?.y).toBe(208)
    } finally {
      run.stop()
    }
  })

  it('leaves the position off a click that reports none', async () => {
    // Enter/Space on a focused control reports 0,0. Recording that would place
    // every keyboard click at the top-left corner of the viewport - 0px from
    // every other keyboard click - which is a mis-click the user never made.
    const run = await bootSdk('<button id="save">Save</button>')
    try {
      const button = run.doc.getElementById('save')!
      click(button)
      await settleUntil(run, (e) => e.eventType === 'CLICK')

      const clicks = eventsOf(run.events, 'CLICK')
      expect(clicks.length).toBe(1)
      expect(clicks[0]!.meta?.x).toBeUndefined()
      expect(clicks[0]!.meta?.y).toBeUndefined()
    } finally {
      run.stop()
    }
  })

  it('survives the wire schema the server validates', async () => {
    const run = await bootSdk('<button id="save">Save</button>')
    try {
      const button = run.doc.getElementById('save')!
      click(button, { clientX: 640, clientY: 480 })
      await settleUntil(run, (e) => e.eventType === 'CLICK')

      const clickEvent = eventsOf(run.events, 'CLICK')[0]!
      const { RuntimeEventSchemaExport } = await import('@/lib/ingest/schema')
      const parsed = RuntimeEventSchemaExport.safeParse(clickEvent)
      expect(parsed.success).toBe(true)
      if (!parsed.success) return
      expect(parsed.data.meta?.x).toBe(640)
      expect(parsed.data.meta?.y).toBe(480)
    } finally {
      run.stop()
    }
  })
})
