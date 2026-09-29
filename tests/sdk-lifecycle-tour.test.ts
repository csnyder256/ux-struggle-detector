import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { installDom, uninstallDom, click } from './helpers/sdk-browser'
import type { ElementId } from '@/lib/types/ui-map'
import type { RuntimeEvent } from '@/lib/types/events'
let sdk: typeof import('@/sdk')
let renderers: typeof import('@/sdk/renderers')
beforeEach(async () => {
  installDom('<button id="trigger">Start</button><button id="target">Checkout</button><input id="field">')
  vi.resetModules()
  sdk = await import('@/sdk')
  renderers = await import('@/sdk/renderers')
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})
afterEach(() => {
  sdk.destroySelfHealing()
  vi.restoreAllMocks()
  window.close()
  uninstallDom()
})
function button(label: string): HTMLButtonElement {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(b => b.textContent === label)!
}
function key(value: string, shiftKey = false): void {
  document.activeElement?.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }))
}
const steps = [{ title: 'First', copy: 'Create a signal', selector: '#target' }, { title: 'Second', copy: 'Inspect the evidence' }, { title: 'Third', copy: 'Keep the trace' }]
describe('complete tours', () => {
  it('moves forward and back and completes exactly once with focus restored', () => {
    const finish = vi.fn(), dismiss = vi.fn()
    const trigger = document.getElementById('trigger')!; trigger.focus()
    const tour = sdk.startTour({ steps, onFinish: finish, onDismiss: dismiss })!
    expect(button('Back').disabled).toBe(true)
    button('Next').click(); expect(tour.step).toBe(1)
    button('Back').click(); expect(tour.step).toBe(0)
    tour.next(); tour.next(); expect(tour.step).toBe(2)
    button('Finish tour').click(); tour.next(); tour.close()
    expect(finish).toHaveBeenCalledTimes(1); expect(dismiss).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
  it('traps Tab both ways, supports Escape, and can replay', () => {
    const dismiss = vi.fn()
    sdk.startTour({ steps, onDismiss: dismiss })
    expect(document.activeElement).toBe(button('Next'))
    key('Tab'); expect(document.activeElement).toBe(button('Close tour'))
    key('Tab', true); expect(document.activeElement).toBe(button('Next'))
    key('Escape'); expect(dismiss).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    sdk.startTour({ steps }); expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('First')
  })
  it('renders untrusted copy as text and permits progress past unavailable targets', () => {
    sdk.startTour({ steps: [{ title: '<img src=x onerror=alert(1)>', copy: '<script>bad()</script>', selector: '[' }, { title: 'Done', copy: 'Safe' }] })
    expect(document.querySelector('[role="dialog"] img')).toBeNull()
    expect(document.querySelector('[role="dialog"] script')).toBeNull()
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toContain('<img')
    expect(document.querySelector('[role="dialog"] [role="status"]')?.textContent).toContain('not on the current page')
    button('Next').click(); expect(button('Finish tour')).toBeTruthy()
  })
  it('rejects malformed input without dismissing the active tour', () => {
    sdk.startTour({ steps })
    expect(() => sdk.startTour({ steps: [] })).toThrow()
    expect(() => sdk.startTour({ steps: Array.from({ length: 21 }, () => steps[0]!) })).toThrow()
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('First')
  })
  it('keeps only one tour and separates dismissal from completion', () => {
    const dismiss = vi.fn(), finish = vi.fn()
    sdk.startTour({ steps, onDismiss: dismiss, onFinish: finish })
    sdk.startTour({ steps: [{ title: 'Replacement', copy: 'One step' }] })
    expect(dismiss).toHaveBeenCalledTimes(1); expect(finish).not.toHaveBeenCalled()
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  })
  it('reports the persisted row only when the final step is finished', () => {
    const outcomes: Array<[string, string]> = []
    renderers.setOutcomeCallback((id, outcome) => outcomes.push([id, outcome]))
    sdk.renderIntervention({ id: 'session_tour', rowId: 'persisted_tour', type: 'TOUR', targetElementId: null, copy: 'Guide', options: { steps: JSON.stringify(steps) } })
    expect(outcomes).toEqual([['persisted_tour', 'shown']])
    button('Next').click(); button('Next').click()
    expect(outcomes).toEqual([['persisted_tour', 'shown']])
    button('Finish tour').click()
    expect(outcomes).toEqual([['persisted_tour', 'shown'], ['persisted_tour', 'success']])
  })
})
describe('SDK lifecycle', () => {
  it('importing the package entry is inert even in a browser', async () => {
    const push = history.pushState
    await import('@/sdk/package-entry')
    expect(history.pushState).toBe(push)
    click(document.getElementById('target')!)
    expect(await sdk.flush()).toEqual({ sent: 0 })
  })
  it('stops collectors and restores history, then resumes without duplicate listeners', async () => {
    const events: RuntimeEvent[] = [], push = history.pushState
    sdk.initSelfHealing({ orgId: 'org_test', endpoint: 'console', onEvent: e => events.push(e) })
    expect(history.pushState).not.toBe(push)
    click(document.getElementById('target')!); await sdk.flush()
    expect(events.filter(e => e.eventType === 'CLICK')).toHaveLength(1)
    sdk.destroySelfHealing(); expect(history.pushState).toBe(push)
    click(document.getElementById('target')!); expect(await sdk.flush()).toEqual({ sent: 0 })
    expect(events.filter(e => e.eventType === 'CLICK')).toHaveLength(1)
    sdk.initSelfHealing({ orgId: 'org_test', endpoint: 'console', onEvent: e => events.push(e) })
    click(document.getElementById('target')!); await sdk.flush()
    expect(events.filter(e => e.eventType === 'CLICK')).toHaveLength(2)
  })
  it('does not overwrite a history wrapper installed later by the host', () => {
    sdk.initSelfHealing({ orgId: 'org_test', endpoint: 'console' })
    const sdkPush = history.pushState
    const hostPush: History['pushState'] = function (this: History, ...args) { sdkPush.apply(this, args) }
    history.pushState = hostPush
    sdk.destroySelfHealing()
    expect(history.pushState).toBe(hostPush)
  })
  it('removes interventions, focus traps and owned timers on destroy', async () => {
    sdk.initSelfHealing({ orgId: 'org_test', endpoint: 'console' })
    click(document.getElementById('target')!); await sdk.flush()
    const id = document.getElementById('target')!.getAttribute('data-sh-id')! as ElementId
    sdk.renderIntervention({ id: 'hint', type: 'TOOLTIP', targetElementId: id, copy: 'Help', autoDismissMs: 0 })
    sdk.startTour({ steps }); sdk.destroySelfHealing()
    expect(document.getElementById('__sh_root__')).toBeNull()
    expect(document.getElementById('__sh_styles__')).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(await sdk.flush()).toEqual({ sent: 0 })
  })
  it('does not let a late identity hash identify a new initialization', async () => {
    const events: RuntimeEvent[] = []
    sdk.initSelfHealing({ orgId: 'org_test', endpoint: 'console' }); await sdk.flush()
    let resolve!: (value: ArrayBuffer) => void
    vi.spyOn(crypto.subtle, 'digest').mockReturnValueOnce(new Promise(r => { resolve = r }))
    sdk.identify('old-user'); sdk.destroySelfHealing()
    sdk.initSelfHealing({ orgId: 'org_new', endpoint: 'console', onEvent: e => events.push(e) })
    resolve(new Uint8Array(32).fill(7).buffer); await Promise.resolve(); await Promise.resolve()
    sdk.track('new-session'); await sdk.flush()
    expect(events.filter(e => e.meta?.name === 'new-session')).toHaveLength(1)
    expect(events.every(e => e.userIdHash === null)).toBe(true)
  })
  it('aborts an in-flight request and ignores its late intervention response', async () => {
    let resolve!: (value: Response) => void
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(r => { resolve = r }))
    sdk.initSelfHealing({ orgId: 'org_test', endpoint: '/api/events' })
    const flushing = sdk.flush()
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const signal = fetchSpy.mock.calls[0]![1]!.signal!
    sdk.destroySelfHealing(); expect(signal.aborted).toBe(true)
    resolve(new Response(JSON.stringify({ interventions: [{ id: 'late', type: 'MODAL', targetElementId: null, copy: 'Late response' }] }), { status: 200 }))
    expect(await flushing).toEqual({ sent: 0 })
    expect(document.getElementById('__sh_root__')).toBeNull()
  })
  it('binds runtime IDs for targeting and refreshes them when a reused node changes route', async () => {
    const { resolveElementId } = await import('@/sdk/element-id')
    const target = document.getElementById('target')!
    const first = await resolveElementId('org_test', target)
    expect(target.getAttribute('data-sh-id')).toBe(first)
    history.pushState({}, '', '/different')
    const next = await resolveElementId('org_test', target)
    expect(next).not.toBe(first); expect(target.getAttribute('data-sh-id')).toBe(next)
    sdk.renderIntervention({ id: 'targeted', type: 'INLINE_HINT', targetElementId: next, copy: 'Exact target', autoDismissMs: 0 })
    expect(target.parentElement?.textContent).toContain('Exact target')
  })
  it('keeps host event callbacks from mutating or breaking buffered evidence', async () => {
    const { EventBuffer } = await import('@/sdk/event-buffer')
    const buffered: RuntimeEvent[] = [], original = EventBuffer.prototype.push
    vi.spyOn(EventBuffer.prototype, 'push').mockImplementation(function (this: InstanceType<typeof EventBuffer>, e) { buffered.push(e); return original.call(this, e) })
    sdk.initSelfHealing({ orgId: 'org_test', endpoint: 'console', onEvent: e => { e.eventType = 'JS_ERROR'; throw new Error('Host callback') } })
    click(document.getElementById('target')!); await sdk.flush()
    expect(buffered.filter(e => e.eventType === 'CLICK')).toHaveLength(1)
    expect(buffered.filter(e => e.eventType === 'JS_ERROR')).toHaveLength(0)
  })
})
