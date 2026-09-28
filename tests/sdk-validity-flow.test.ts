/**
 * Custom validity and numeric constraints, through the REAL flow.
 *
 * These tests drive a live jsdom input: the page calls the browser's actual
 * `setCustomValidity()` (and the real `badInput` / `stepMismatch` validity
 * states), the SDK captures the failure off the element, the ingest schema
 * carries it, and the dispatcher renders it into intervention copy.
 *
 * A static `setCustomValidity="..."` JSX attribute is NOT the browser's method
 * and proves nothing, so nothing here uses one.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { JSDOM } from 'jsdom'
import { dispatchInterventions } from '@/lib/interventions/dispatcher'
import { RuntimeEventSchemaExport as RuntimeEventSchema } from '@/lib/ingest/schema'
import type { StruggleDetection } from '@/lib/types/events'
import type { ElementId } from '@/lib/types/ui-map'
import { installDom, eventsOf, moveMouse, tick, bootSdk, click } from './helpers/sdk-dom'

const E1 = 'sh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as ElementId

function installServerGlobals(): void {
  // The dispatcher renders {validation} server-side; it needs no DOM, but the
  // SDK module graph it shares with these files does, so keep jsdom installed.
  installDom('<div></div>')
}

beforeEach(() => installServerGlobals())

afterEach(async () => {
  const { vi } = await import('vitest')
  vi.useRealTimers()
})

/** A detection of the kind a validation failure produces. */
function validationDetection(type: StruggleDetection['type'] = 'FORMAT_ERROR'): StruggleDetection {
  return {
    sessionId: 'sess_1',
    elementId: E1,
    type,
    severity: 0.5,
    ts: new Date('2026-01-01T00:00:00Z').toISOString(),
  }
}

function interval(copy: string): string {
  const m = copy.match(/\{validation\}/)
  return m ? copy : copy
}

describe('runtime setCustomValidity reaches the copy the user sees', () => {
  it('captures the browser message the page set, end to end', async () => {
    const run = await bootSdk('<form><input id="vat" name="vat"></form>')
    try {
      const input = run.doc.getElementById('vat') as HTMLInputElement
      // The REAL browser method, on a real element.
      input.setCustomValidity('That is a card number, not a VAT ID')
      expect(input.validity.customError).toBe(true)

      // Touch the field so the SDK builds element context for it, then hit an
      // event that carries that context.
      input.focus()
      click(input)
      await tick(1_000)

      const withValidity = run.events.filter((e) => e.element?.validity)
      expect(withValidity.length, 'the SDK reports the failing field').toBeGreaterThan(0)
      const failure = withValidity[withValidity.length - 1]!
      expect(failure.element?.validity).toContain('customError')
      expect(failure.element?.validationMessage).toBe(
        'That is a card number, not a VAT ID',
      )

      // The message has to survive ingest, or the server never sees it.
      const parsed = RuntimeEventSchema.safeParse({
        ...failure,
        ts: failure.ts,
        page: failure.page,
      })
      expect(parsed.success).toBe(true)
      if (!parsed.success) return
      const carried = parsed.data.element?.validationMessage
      expect(carried).toBe('That is a card number, not a VAT ID')

      // ... and reach the rendered copy.
      const dispatched = dispatchInterventions([validationDetection()], {
        safeMode: false,
        elementLabels: new Map([[E1, 'Tax ID']]),
        validationMessageByElement: new Map([[E1, carried as string]]),
      })
      expect(dispatched).toHaveLength(1)
      expect(dispatched[0]?.copy).toContain('That is a card number, not a VAT ID')
    } finally {
      run.stop()
    }
  })

  it('does not invent a custom message for a field that only fails required', async () => {
    const run = await bootSdk('<form><input id="vat" name="vat" required></form>')
    try {
      const input = run.doc.getElementById('vat') as HTMLInputElement
      expect(input.validity.valueMissing).toBe(true)
      expect(input.validity.customError).toBe(false)
      input.focus()
      click(input)
      await tick(1_000)

      const withValidity = run.events.filter((e) => e.element?.validity)
      expect(withValidity.length).toBeGreaterThan(0)
      const failure = withValidity[withValidity.length - 1]!
      expect(failure.element?.validity).toContain('valueMissing')
      expect(failure.element?.validationMessage).toBeUndefined()
    } finally {
      run.stop()
    }
  })

  it('reads a real badInput state when the field actually fails validation', async () => {
    const run = await bootSdk('<form><input id="qty" name="qty" type="number"></form>')
    try {
      const input = run.doc.getElementById('qty') as HTMLInputElement
      // `badInput` is set by the browser when the typed value cannot be parsed
      // as a number. jsdom does not compute it, so install both the validity
      // state AND the matching `checkValidity()` result, which is what the SDK
      // actually consults - overriding one without the other proves nothing.
      const bad = {
        valueMissing: false,
        typeMismatch: false,
        patternMismatch: false,
        tooShort: false,
        tooLong: false,
        rangeUnderflow: false,
        rangeOverflow: false,
        stepMismatch: false,
        badInput: true,
        customError: false,
        valid: false,
      }
      Object.defineProperty(input, 'validity', { value: bad, configurable: true })
      Object.defineProperty(input, 'checkValidity', { value: () => false, configurable: true })
      Object.defineProperty(input, 'validationMessage', {
        value: 'Please enter a number.',
        configurable: true,
      })

      input.focus()
      click(input)
      await tick(1_000)

      const withValidity = run.events.filter((e) => e.element?.validity)
      expect(withValidity.length).toBeGreaterThan(0)
      const failure = withValidity[withValidity.length - 1]!
      expect(failure.element?.validity).toContain('badInput')

      const parsed = RuntimeEventSchema.safeParse(failure)
      expect(parsed.success).toBe(true)
    } finally {
      run.stop()
    }
  })

  it('a field the browser does not consider invalid reports no validity flags', async () => {
    // The SDK only asks for flags when `checkValidity()` is false, so a field
    // that passes validation must not be described as failing one.
    const run = await bootSdk('<form><input id="ok" name="ok" value="fine"></form>')
    try {
      const input = run.doc.getElementById('ok') as HTMLInputElement
      expect(input.checkValidity()).toBe(true)
      input.focus()
      click(input)
      await tick(1_000)
      const withValidity = run.events.filter((e) => e.element?.validity)
      expect(withValidity).toHaveLength(0)
    } finally {
      run.stop()
    }
  })
})

describe('numeric constraints render honest, usable guidance', () => {
  it('a step anchored on min lists the values that are actually allowed', () => {
    // min="1" step="5" permits 1, 6, 11 - NOT multiples of 5.
    const dispatched = dispatchInterventions([validationDetection()], {
      safeMode: false,
      elementLabels: new Map([[E1, 'Quantity']]),
      elementValidation: new Map([
        [E1, { step: 5, min: 1, max: 100, stepMismatch: true, inputType: 'number' }],
      ]),
    })
    expect(dispatched).toHaveLength(1)
    const copy = dispatched[0]!.copy
    expect(copy).not.toMatch(/multiple of 5/)
    expect(copy).toMatch(/one of 1, 6, 11, 16/)
  })

  it('a range failure names the real bound instead of a generic format error', () => {
    const dispatched = dispatchInterventions([validationDetection()], {
      safeMode: false,
      elementLabels: new Map([[E1, 'Quantity']]),
      elementValidation: new Map([[E1, { rangeUnderflow: true, min: 1, inputType: 'number' }]]),
    })
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]!.copy).toMatch(/at least 1/)
  })

  it('keeps required distinct from format', () => {
    const dispatched = dispatchInterventions(
      [validationDetection('REQUIRED_MISSED')],
      {
        safeMode: false,
        elementLabels: new Map([[E1, 'Tax ID']]),
        elementValidation: new Map([[E1, { required: true, valueMissing: true }]]),
      },
    )
    expect(dispatched).toHaveLength(1)
    const copy = dispatched[0]!.copy
    expect(copy).toMatch(/required/)
    expect(copy).not.toMatch(/valid format/)
  })
})
