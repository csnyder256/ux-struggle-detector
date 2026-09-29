/** Accessible, replayable tours with explicit completion and complete teardown. */
export interface TourStep {
  title: string
  copy: string
  /** Optional host selector. A missing/invalid target is announced and does not trap progress. */
  selector?: string
  targetElementId?: string
}
export interface TourOptions {
  steps: TourStep[]
  onFinish?: () => void
  onDismiss?: () => void
}
export interface TourHandle {
  next: () => void
  back: () => void
  close: () => void
  readonly step: number
}
const activeTours = new Set<() => void>()
let sequence = 0
export function closeTours(): void {
  for (const close of [...activeTours]) close()
}
/** Returns null during SSR; malformed runtime input leaves the current tour intact. */
export function startTour(options: TourOptions): TourHandle | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null
  if (!options || !Array.isArray(options.steps) || options.steps.length < 1 || options.steps.length > 20) throw new TypeError('A tour needs 1–20 steps')
  const steps = options.steps.map((s) => {
    if (!s || typeof s.title !== 'string' || !s.title.trim() || s.title.length > 160 || typeof s.copy !== 'string' || s.copy.length > 4000 || (s.selector !== undefined && (typeof s.selector !== 'string' || s.selector.length > 256)) || (s.targetElementId !== undefined && (typeof s.targetElementId !== 'string' || s.targetElementId.length > 128))) throw new TypeError('Invalid tour step')
    return { ...s }
  })
  closeTours()
  let index = 0
  let closed = false
  const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const uid = '__sh_tour_' + (++sequence)
  const backdrop = document.createElement('div')
  backdrop.dataset.shTour = 'true'
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:2147483645;background:rgba(9,16,31,.55);display:flex;align-items:flex-end;justify-content:center;padding:24px;box-sizing:border-box;pointer-events:auto;font-family:system-ui,sans-serif;'
  const panel = document.createElement('section')
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-labelledby', uid + '_title')
  panel.setAttribute('aria-describedby', uid + '_body')
  panel.style.cssText = 'position:relative;z-index:2;background:#fff;color:#172033;border:1px solid #dbe4ee;border-radius:18px;padding:24px;width:520px;max-width:100%;max-height:calc(100dvh - 48px);overflow:auto;box-sizing:border-box;box-shadow:0 24px 80px #0005;'
  const progress = document.createElement('p')
  progress.style.cssText = 'margin:0 0 10px;color:#52677f;font-size:12px;font-weight:700;letter-spacing:.06em;'
  progress.setAttribute('aria-live', 'polite')
  const title = document.createElement('h2')
  title.id = uid + '_title'
  title.style.cssText = 'font-size:23px;line-height:1.3;margin:0 0 12px;'
  const body = document.createElement('p')
  body.id = uid + '_body'
  body.style.cssText = 'margin:0;white-space:pre-line;font-size:15px;line-height:1.7;'
  const context = document.createElement('p')
  context.setAttribute('role', 'status')
  context.style.cssText = 'color:#596d80;font-size:12px;line-height:1.5;'
  const actions = document.createElement('div')
  actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:20px;'
  function button(label: string, primary = false): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'; b.textContent = label
    b.style.cssText = 'font:600 14px system-ui;padding:11px 18px;border-radius:9px;cursor:pointer;border:1px solid #ccd8e5;background:' + (primary ? '#183dba;color:#fff;' : '#fff;color:#172033;')
    return b
  }
  const dismiss = button('Close tour')
  const previous = button('Back')
  const next = button('Next', true)
  actions.append(dismiss, previous, next)
  panel.append(progress, title, body, context, actions)
  const ring = document.createElement('div')
  ring.setAttribute('aria-hidden', 'true')
  ring.style.cssText = 'position:fixed;border:3px solid #75e9c5;border-radius:8px;box-shadow:0 0 0 4px #75e9c533;pointer-events:none;box-sizing:border-box;'
  backdrop.append(ring, panel)
  document.body.append(backdrop)
  let target: HTMLElement | null = null
  function positionRing(): void {
    if (!target?.isConnected) { ring.hidden = true; return }
    const r = target.getBoundingClientRect()
    ring.hidden = r.width === 0 || r.height === 0
    Object.assign(ring.style, { left: (r.left - 5) + 'px', top: (r.top - 5) + 'px', width: (r.width + 10) + 'px', height: (r.height + 10) + 'px' })
  }
  function render(): void {
    const step = steps[index]!
    progress.textContent = 'STEP ' + (index + 1) + ' OF ' + steps.length
    title.textContent = step.title; body.textContent = step.copy
    previous.disabled = index === 0
    previous.style.opacity = index === 0 ? '.45' : '1'
    next.textContent = index === steps.length - 1 ? 'Finish tour' : 'Next'
    target = null
    try {
      if (step.selector) target = document.querySelector<HTMLElement>(step.selector)
      else if (step.targetElementId) target = Array.from(document.querySelectorAll<HTMLElement>('[data-sh-id]')).find(e => e.getAttribute('data-sh-id') === step.targetElementId) ?? null
    } catch { /* Invalid selectors are presented as missing context. */ }
    context.textContent = (step.selector || step.targetElementId) && !target ? 'This target is not on the current page. You can continue or return when it is available.' : ''
    target?.scrollIntoView?.({ block: 'center', behavior: 'instant' })
    positionRing()
    next.focus()
  }
  function close(completed = false): void {
    if (closed) return
    closed = true
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', positionRing)
    window.removeEventListener('scroll', positionRing, true)
    activeTours.delete(cancel)
    backdrop.remove()
    if (priorFocus?.isConnected) priorFocus.focus()
    try { if (completed) options.onFinish?.(); else options.onDismiss?.() } catch { /* Isolate host callbacks. */ }
  }
  const cancel = () => close(false)
  function forward(): void {
    if (closed) return
    if (index === steps.length - 1) close(true)
    else { index++; render() }
  }
  function back(): void {
    if (!closed && index > 0) { index--; render() }
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return }
    if (e.key !== 'Tab') return
    const buttons = [dismiss, previous, next].filter(b => !b.disabled)
    const first = buttons[0]!, last = buttons[buttons.length - 1]!
    if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { e.preventDefault(); first.focus() }
  }
  dismiss.addEventListener('click', cancel)
  previous.addEventListener('click', back)
  next.addEventListener('click', forward)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', positionRing)
  window.addEventListener('scroll', positionRing, true)
  activeTours.add(cancel)
  render()
  return { next: forward, back, close: cancel, get step() { return index } }
}
