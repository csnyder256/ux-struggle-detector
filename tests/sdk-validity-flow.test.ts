/**
 * Custom validity and numeric constraints, through the REAL flow.
 *
 * These tests drive a live jsdom input: the page calls jsdom's actual
 * `setCustomValidity()` (which jsdom implements as spec'd), the SDK captures the
 * failure off the element, the ingest schema carries it, and the dispatcher
 * renders it into intervention copy.
 *
 * jsdom is a DOM implementation, not a browser. It implements
 * `setCustomValidity` and `customError`, but it does NOT compute `badInput`
 * (the browser state for a value that cannot be parsed as a number). The
 * `badInput` case below therefore installs a mocked validity state AND the
 * matching `checkValidity()` result, so the mock agrees with itself - it proves
 * the SDK's handling of a reported `badInput`, not that a browser sets the flag.
 * The real-browser observation lives in docs/browser-evidence.md (headless
 * Chromium). Prose here says "jsdom reports", never "the browser does".
 *
 * A static `setCustomValidity="..."` JSX attribute is NOT the browser's method
 * and proves nothing, so nothing here uses one.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { JSDOM } from 'jsdom'
import { dispatchInterventions } from '@/lib/interventions/dispatcher'
import { RuntimeEventSchemaExport as RuntimeEventSchema } from '@/lib/ingest/schema'
import type { StruggleDetection, RuntimeEvent } from '@/lib/types/events'
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

/**
 * Let the SDK's async emit chain settle until at least one event matching
 * `pred` has landed in the buffer, or the tick budget runs out. Await the real
 * SDK flush barrier: fake clock advances and microtask yields cannot guarantee
 * native WebCrypto completion on a loaded runner. Transport is mocked by the
 * shared harness, so this settles real capture without network access.
 */
async function settleUntil(
  run: { events: RuntimeEvent[]; settle: () => Promise<unknown> },
  pred: (e: RuntimeEvent) => boolean,
  maxTicks = 40,
): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    await run.settle()
    if (run.events.some(pred)) return
    await tick(1_000)
  }
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
      await settleUntil(run, (e) => Boolean(e.element?.validity))

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
        validationMessageByElement: new Map([['sess_1', new Map([[E1, carried as string]])]]),
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
      await settleUntil(run, (e) => Boolean(e.element?.validity))

      const withValidity = run.events.filter((e) => e.element?.validity)
      expect(withValidity.length).toBeGreaterThan(0)
      const failure = withValidity[withValidity.length - 1]!
      expect(failure.element?.validity).toContain('valueMissing')
      expect(failure.element?.validationMessage).toBeUndefined()
    } finally {
      run.stop()
    }
  })

  it('reports badInput when the validity state says so (jsdom cannot compute it, so it is mocked)', async () => {
    const run = await bootSdk('<form><input id="qty" name="qty" type="number"></form>')
    try {
      const input = run.doc.getElementById('qty') as HTMLInputElement
      // `badInput` is set by a real browser when the typed value cannot be
      // parsed as a number. jsdom does not compute it, so install both the
      // validity state AND the matching `checkValidity()` result, which is what
      // the SDK actually consults - overriding one without the other proves
      // nothing. This pins the SDK's handling of a reported flag; the real
      // browser observation is in docs/browser-evidence.md.
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
      await settleUntil(run, (e) => Boolean(e.element?.validity))

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
      // Wait for the click to actually land, then assert it carries no validity
      // flags - waiting on a fixed tick would pass trivially if the event
      // simply had not arrived yet.
      await settleUntil(run, (e) => e.eventType === 'CLICK')
      const clicks = run.events.filter((e) => e.eventType === 'CLICK')
      expect(clicks.length).toBeGreaterThan(0)
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

  it('does not double the sentence period when the page message already ends in one', () => {
    // A real browser `validationMessage` ends with a period, and the template
    // ("{label} {validation}.") adds its own - the browser evidence run
    // rendered "Tax ID That is a card number, not a VAT ID.." before this was
    // normalised.
    const dispatched = dispatchInterventions([validationDetection()], {
      safeMode: false,
      elementLabels: new Map([[E1, 'Tax ID']]),
      validationMessageByElement: new Map([
        ['sess_1', new Map([[E1, 'That is a card number, not a VAT ID.']])],
      ]),
    })
    expect(dispatched).toHaveLength(1)
    const copy = dispatched[0]!.copy
    expect(copy).toContain('That is a card number, not a VAT ID.')
    expect(copy).not.toMatch(/\.\./)
  })
})


it('scrubs field echoes and personal data before sending a custom validity message', async () => {
  const run = await bootSdk('<form><input id="private" name="private"></form>')
  try {
    const input = run.doc.getElementById('private') as HTMLInputElement
    input.value = 'private-label'
    input.setCustomValidity('private-label belongs to person@example.com; call 415-555-2671')
    input.focus()
    click(input)
    await settleUntil(run, (e) => Boolean(e.element?.validationMessage))
    const messages = run.events.map((e) => e.element?.validationMessage).filter(Boolean)
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.join(' ')).not.toMatch(/private-label|person@example.com|415-555-2671/)
  } finally { run.stop() }
})

it('keeps runtime validation messages isolated by session', () => {
  const first = validationDetection()
  const second = { ...first, sessionId: 'sess_2' }
  const messages = new Map([
    ['sess_1', new Map([[E1, 'First session message']])],
    ['sess_2', new Map([[E1, 'Second session message']])],
  ])
  const results = dispatchInterventions([first, second], {
    safeMode: false, validationMessageByElement: messages,
  })
  expect(results).toHaveLength(2)
  expect(results[0]!.copy).toContain('First session message')
  expect(results[0]!.copy).not.toContain('Second session message')
  expect(results[1]!.copy).toContain('Second session message')
})
