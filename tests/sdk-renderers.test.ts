/**
 * What the intervention renderers do to the customer's page.
 *
 * These are the SDK's only user-visible output: when the detector decides a
 * user is stuck, one of these draws. So the assertions are about what a person
 * sees and what a screen reader announces, not about which DOM node was
 * created:
 *
 *   - the dimmer leaves the target visible, and the ring is drawn where the
 *     element actually is,
 *   - a panel anchored to an element stays inside the viewport, because an
 *     implementation that positions off-screen is indistinguishable from one
 *     that never rendered,
 *   - the id reported with an outcome is the one the server persisted the row
 *     under, because that is the only id `/api/events` can look up,
 *   - a dismissable panel that leaves the document does not also leave a live
 *     Escape listener behind it.
 *
 * jsdom reports every `getBoundingClientRect()` as 0x0, so the harness stubs
 * the geometry each renderer reads. Nothing about the renderer itself is
 * stubbed: the real `renderIntervention` runs against a real document.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import type { DispatchedIntervention } from '@/lib/types/events'

const ROOT_ID = '__sh_root__'
const TARGET_ID = 'sh_00000000000000000000000000000001'

/**
 * The renderer module keeps two pieces of module-level state that a real page
 * would only ever see on one document: `shown`, the set of intervention ids
 * already rendered this session, and the single outcome callback. Both have to
 * start empty for each test, or the second test in the file silently renders
 * nothing and asserts on an empty document.
 */
type Renderers = typeof import('@/sdk/renderers')
let renderers: Renderers

async function freshRenderers(): Promise<Renderers> {
  vi.resetModules()
  return import('@/sdk/renderers')
}

/** Feedback collected from the module-level outcome callback. */
interface Outcome {
  id: string
  outcome: string
}

interface Harness {
  doc: Document
  win: Window & typeof globalThis
  outcomes: Outcome[]
  element: HTMLElement
}

/**
 * Each renderer looks its anchor up itself, and the renderers are all
 * function-local in the module, so the only handle a test has on them is the
 * document they read. This is that document.
 */
let harness: Harness

/** A viewport to lay the element out in. */
const VIEWPORT = { w: 1280, h: 800 }

function installDom(html: string, viewport = VIEWPORT): Harness {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'http://localhost/checkout',
    pretendToBeVisual: true,
  })
  const w = dom.window as unknown as Window & typeof globalThis
  const define = (key: string, value: unknown) =>
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: false,
    })
  for (const key of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'Event',
    'KeyboardEvent',
    'MouseEvent',
    'getComputedStyle',
  ]) {
    define(key, (w as unknown as Record<string, unknown>)[key])
  }
  // jsdom has no layout, so it answers every box with 0x0 and every viewport
  // with the window's default. Both are inputs to the placement maths under
  // test, so they get real values.
  Object.defineProperty(w, 'innerWidth', { value: viewport.w, writable: true, configurable: true })
  Object.defineProperty(w, 'innerHeight', { value: viewport.h, writable: true, configurable: true })

  const element = w.document.getElementById('target') as HTMLElement
  box(element, { left: 100, top: 200, width: 180, height: 40 })
  return { doc: w.document, win: w, outcomes: [], element }
}

/** Give one element a real box, the way a laid-out browser would. */
function box(el: HTMLElement, rect: { left: number; top: number; width: number; height: number }): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () =>
      ({
        ...rect,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left,
        y: rect.top,
        toJSON: () => ({}),
      }) as DOMRect,
    writable: true,
    configurable: true,
  })
}

function rootEl(doc: Document): HTMLElement | null {
  return doc.getElementById(ROOT_ID)
}

/** Every element the intervention root is currently holding. */
function painted(doc: Document): HTMLElement[] {
  return Array.from(rootEl(doc)?.children ?? []) as HTMLElement[]
}

function intervention(over: Partial<DispatchedIntervention> = {}): DispatchedIntervention {
  return {
    id: 'iv_session_specific',
    rowId: 'iv_population_row',
    type: 'OVERLAY',
    targetElementId: TARGET_ID,
    copy: 'Looks like you meant to finish this order.',
    autoDismissMs: 8000,
    confidence: 0.9,
    ...over,
  } as DispatchedIntervention
}

beforeEach(async () => {
  harness = installDom(
    `<div><button id="target" data-sh-id="${TARGET_ID}">Complete purchase</button></div>`,
  )
  box(harness.element, { left: 100, top: 200, width: 180, height: 40 })
  instrumentKeydownListeners(harness.doc)
  renderers = await freshRenderers()
  renderers.setOutcomeCallback((id, outcome) => harness.outcomes.push({ id, outcome }))
})

afterEach(() => {
  renderers.setOutcomeCallback(null)
  vi.useRealTimers()
})

/** The real entry point, through a module whose `shown` set is empty. */
function render(d: DispatchedIntervention): void {
  renderers.renderIntervention(d)
}

describe('SPOTLIGHT leaves the target visible', () => {
  beforeEach(() => {
    render(intervention({ type: 'SPOTLIGHT', autoDismissMs: 6000 }))
  })

  it('punches the hole with percentages of the overlay box, never raw pixels', () => {
    const overlay = painted(harness.doc).find(
      (el) => el.style.clipPath !== '' && el.style.background.includes('rgba'),
    )
    expect(overlay, 'the dimmer overlay rendered').toBeTruthy()
    const clip = overlay!.style.clipPath
    // A basic shape resolves against the box it is applied to, and this box is
    // the viewport. Pixel coordinates here would be measured from the overlay's
    // own origin, so on any document taller than the viewport the hole lands
    // outside the box and the clip-path resolves to nothing.
    expect(clip).not.toMatch(/\d+px/)
    expect(clip).toMatch(/^polygon\(/)
    // The hole is the element's box plus the 6px inset, as fractions of the
    // 1280x800 viewport - so it tracks the viewport instead of drifting off it.
    expect(clip).toContain(`${round(((100 - 6) / 1280) * 100)}%`)
    expect(clip).toContain(`${round(((200 - 6) / 800) * 100)}%`)
    expect(clip).toContain(`${round(((280 + 6) / 1280) * 100)}%`)
    expect(clip).toContain(`${round(((240 + 6) / 800) * 100)}%`)
  })

  it('draws the hole as a hole, so the dimmer is not painted over the target', () => {
    const overlay = painted(harness.doc).find((el) => el.style.clipPath !== '')!
    const clip = overlay.style.clipPath
    // Two subpaths plus the enclosing rectangle: the outer box first, then the
    // inner hole, with `evenodd` so the overlap between them is the part that
    // is clipped away. Without the inner subpath the dimmer covers everything.
    const points = clip.match(/(?:[\d.]+%|[\d.]+px)\s+(?:[\d.]+%|[\d.]+px)/g) ?? []
    expect(points.length, 'outer box + 5-point hole').toBe(10)
    expect(clip).toContain('evenodd')
  })

  it('rings the element where it actually is', () => {
    const ring = painted(harness.doc).find((el) => el.style.borderRadius === '8px')
    expect(ring, 'the highlight ring rendered').toBeTruthy()
    expect(ring!.style.left).toBe('96px')
    expect(ring!.style.top).toBe('196px')
    expect(ring!.style.width).toBe('188px')
    expect(ring!.style.height).toBe('48px')
  })
})

describe('anchored panels stay inside the viewport', () => {
  it('keeps a TOOLTIP on screen for an element near the right edge', () => {
    box(harness.element, { left: VIEWPORT.w - 60, top: 120, width: 50, height: 24 })
    render(intervention({ type: 'TOOLTIP' }))

    const tip = painted(harness.doc).find((el) => el.getAttribute('role') === 'tooltip')
    expect(tip, 'the tooltip rendered').toBeTruthy()
    const left = px(tip!.style.left)
    const right = left + tip!.getBoundingClientRect().width
    // 280px max width plus the 8px gutter the renderer already reserved.
    expect(left).toBeGreaterThanOrEqual(8)
    expect(right).toBeLessThanOrEqual(VIEWPORT.w - 8)
  })

  it('keeps an INLINE_HINT on screen below an element at the bottom edge', () => {
    box(harness.element, { left: 40, top: VIEWPORT.h - 30, width: 120, height: 24 })
    render(intervention({ type: 'INLINE_HINT' }))

    const hint = painted(harness.doc).find((el) => el !== rootEl(harness.doc) && el.textContent?.includes('finish this order') && el.style.borderRadius === '4px')
    expect(hint, 'the inline hint rendered').toBeTruthy()
    const top = px(hint!.style.top)
    // Anchored under an element that ends 6px above the fold, the unclamped
    // placement puts it entirely off the bottom of the screen.
    expect(top).toBeGreaterThanOrEqual(0)
    expect(top + hint!.getBoundingClientRect().height).toBeLessThanOrEqual(VIEWPORT.h)
  })

  it('keeps an ARROW on screen pointing at an element at the top edge', () => {
    box(harness.element, { left: 200, top: 2, width: 120, height: 30 })
    render(intervention({ type: 'ARROW' }))

    const arrow = painted(harness.doc).find((el) => el.textContent === '↓')
    expect(arrow, 'the arrow rendered').toBeTruthy()
    // `rect.top - 36` is above the fold for anything within 36px of it.
    expect(px(arrow!.style.top)).toBeGreaterThanOrEqual(0)
    expect(px(arrow!.style.left)).toBeGreaterThanOrEqual(0)
  })
})

describe('outcome events carry the persisted row id', () => {
  it('reports against rowId, the id /api/events can look up', () => {
    render(intervention({ type: 'OVERLAY' }))
    expect(harness.outcomes).toEqual([{ id: 'iv_population_row', outcome: 'shown' }])
    expect(harness.outcomes.some((o) => o.id === 'iv_session_specific')).toBe(false)
  })

  it('falls back to the session id for a locally rendered intervention', () => {
    render(intervention({ type: 'OVERLAY', rowId: undefined }))
    expect(harness.outcomes).toEqual([{ id: 'iv_session_specific', outcome: 'shown' }])
  })

  it('reports a success when the user clicks the highlighted element', () => {
    render(intervention({ type: 'HIGHLIGHT' }))
    harness.element.dispatchEvent(
      new harness.win.MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    expect(harness.outcomes).toContainEqual({ id: 'iv_population_row', outcome: 'success' })
  })

  it('reports a dismissal from the close button on a banner', () => {
    render(intervention({ type: 'BANNER' }))
    const banner = painted(harness.doc).find((el) =>
      el.querySelector('button[aria-label="Dismiss"]'),
    )
    expect(banner, 'the banner rendered').toBeTruthy()
    banner!.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!.click()
    expect(harness.outcomes).toContainEqual({ id: 'iv_population_row', outcome: 'dismissed' })
  })
})

describe('Escape listeners do not outlive the panel they belong to', () => {
  it('detaches when the banner is closed with the ×', () => {
    render(intervention({ type: 'BANNER' }))
    const before = countKeydownListeners()
    const banner = painted(harness.doc).find((el) =>
      el.querySelector('button[aria-label="Dismiss"]'),
    )!
    banner.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!.click()
    expect(countKeydownListeners()).toBe(before - 1)
  })

  it('detaches when a banner auto-dismisses', async () => {
    vi.useFakeTimers()
    const before = countKeydownListeners()
    render(intervention({ type: 'BANNER', autoDismissMs: 3000 }))
    expect(countKeydownListeners()).toBe(before + 1)
    await vi.advanceTimersByTimeAsync(3001)
    expect(countKeydownListeners()).toBe(before)
  })

  it('detaches on Escape', () => {
    render(intervention({ type: 'OVERLAY' }))
    const before = countKeydownListeners() - 1
    harness.doc.dispatchEvent(
      new harness.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    expect(countKeydownListeners()).toBe(before)
    expect(harness.outcomes).toContainEqual({ id: 'iv_population_row', outcome: 'dismissed' })
  })

  it('does not accumulate a listener per rendered intervention', () => {
    const before = countKeydownListeners()
    for (let i = 0; i < 5; i++) {
      render(
        intervention({ type: 'MODAL', id: `iv_modal_${i}`, rowId: `iv_row_${i}` }),
      )
    }
    // A MODAL attaches two keydown handlers: one for Escape, and one for the
    // Tab focus trap. Both come off again when the modal closes.
    expect(countKeydownListeners()).toBe(before + 10)
    // Closing each one returns to where we started rather than leaving the
    // handlers behind for the rest of the session.
    for (const btn of Array.from(harness.doc.querySelectorAll('button'))) {
      if (btn.textContent === 'Got it') btn.click()
    }
    expect(countKeydownListeners()).toBe(before)
  })
})

// ── helpers ─────────────────────────────────────────────────────────────────

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}
function px(v: string): number {
  return Number.parseFloat(v || '0')
}

/**
 * How many capture-phase keydown handlers are currently registered on the
 * document.
 *
 * jsdom does not expose its listener registry, so this counts them the only way
 * that observes the renderer's real behaviour: by wrapping the document's own
 * `addEventListener` / `removeEventListener` and tracking the `keydown`
 * capture handlers that go in and come out. Nothing about the renderer is
 * stubbed - it registers and unregisters through these methods exactly as it
 * would in a browser.
 */
function instrumentKeydownListeners(doc: Document): void {
  const live = new Set<EventListener>()
  const add = doc.addEventListener.bind(doc)
  const remove = doc.removeEventListener.bind(doc)
  doc.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture)
    if (type === 'keydown' && capture && listener) live.add(listener as EventListener)
    add(type, listener as EventListener, options)
  }) as Document['addEventListener']
  doc.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) => {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture)
    if (type === 'keydown' && capture && listener) live.delete(listener as EventListener)
    remove(type, listener as EventListener, options)
  }) as Document['removeEventListener']
  ;(doc as unknown as { __shKeydown?: Set<EventListener> }).__shKeydown = live
}

function countKeydownListeners(): number {
  return (harness.doc as unknown as { __shKeydown?: Set<EventListener> }).__shKeydown?.size ?? 0
}


it('renders untrusted copy as text and keeps entity typography', () => {
  render(intervention({ copy: '<img src=x onerror="alert(1)"> &rsquo;help&rsquo;' }))
  const root = harness.doc.getElementById('__struggle_heal_root__') ?? harness.doc.body
  expect(root.querySelector('img')).toBeNull()
  expect(root.textContent).toContain('<img src=x onerror="alert(1)"> ’help’')
})

it('deduplicates session ids independently of population outcome ids', () => {
  render(intervention({ id: 'session-first' }))
  render(intervention({ id: 'session-first' }))
  render(intervention({ id: 'session-second' }))
  expect(harness.outcomes.filter((o) => o.outcome === 'shown')).toHaveLength(2)
  expect(harness.outcomes.every((o) => o.id === 'iv_population_row')).toBe(true)
})
