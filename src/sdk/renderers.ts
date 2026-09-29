/**
 * Intervention renderers - a function per InterventionRenderType that
 * draws (or undraws) the visual treatment in the customer's DOM.
 *
 * Every renderer:
 *   - Mounts under a single root container so cleanup is one removeChild()
 *   - Uses inline styles only (no external CSS - we don't want to step on
 *     the host app's stylesheet)
 *   - Auto-dismisses after `autoDismissMs` if provided, else stays until
 *     the user dismisses or session ends
 *   - Respects `prefers-reduced-motion` (animations are subdued)
 *   - All renderers share `mount()` / `unmount()` semantics
 */

import type { DispatchedIntervention, InterventionRenderType } from '../lib/types/events'
import { startTour, closeTours, type TourStep } from './tours'
import type { ElementId } from '../lib/types/ui-map'

const ROOT_ID = '__sh_root__'
const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
const Z = {
  spotlight: 999990,
  ring: 999992,
  card: 999995,
  banner: 999996,
  modal: 999998,
  arrow: 999993,
} as const
const REDUCED =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const shown = new Set<string>()
const pending = new Map<number, () => void>()
const detachments = new Set<() => void>()
function later(fn: () => void, ms: number): number {
  const id = window.setTimeout(() => { pending.delete(id); fn() }, ms)
  pending.set(id, fn)
  return id
}
/** Tear down every SDK-owned DOM treatment, timer and document/target listener. */
export function resetRenderers(): void {
  closeTours()
  for (const [id, finish] of pending) { window.clearTimeout(id); finish() }
  pending.clear()
  for (const detach of [...detachments]) detach()
  detachments.clear()
  document.getElementById(ROOT_ID)?.remove()
  document.getElementById('__sh_styles__')?.remove()
  shown.clear()
  outcomeCallback = null
}

export type OutcomeKind = 'shown' | 'dismissed' | 'success'
export type OutcomeCallback = (interventionId: string, outcome: OutcomeKind) => void

let outcomeCallback: OutcomeCallback | null = null
export function setOutcomeCallback(cb: OutcomeCallback | null): void {
  outcomeCallback = cb
}
function reportOutcome(id: string, outcome: OutcomeKind): void {
  try {
    outcomeCallback?.(id, outcome)
  } catch {
    // ignore
  }
}

function root(): HTMLElement {
  let el = document.getElementById(ROOT_ID)
  if (!el) {
    el = document.createElement('div')
    el.id = ROOT_ID
    Object.assign(el.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: String(Z.spotlight),
    } as Partial<CSSStyleDeclaration>)
    // Inject a stylesheet for keyframes / a11y once.
    const style = document.createElement('style')
    style.id = '__sh_styles__'
    style.textContent = `
      @keyframes __sh_pulse__ {
        0%   { box-shadow: 0 0 0 0 rgba(59,130,246,.55), 0 0 0 0 rgba(59,130,246,.4); }
        70%  { box-shadow: 0 0 0 14px rgba(59,130,246,0),  0 0 0 24px rgba(59,130,246,0); }
        100% { box-shadow: 0 0 0 0 rgba(59,130,246,0),    0 0 0 0 rgba(59,130,246,0); }
      }
      @keyframes __sh_in__   { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes __sh_flash__ { 0%,100% { background:transparent } 50% { background: rgba(250,204,21,.35) } }
      .__sh_card__ { animation: __sh_in__ 180ms ease-out both; }
      .__sh_pulse__ { animation: __sh_pulse__ 1.6s cubic-bezier(.66,0,0,1) infinite; }
      .__sh_flash__ { animation: __sh_flash__ 1.2s ease-in-out 2; }
    `
    document.head.appendChild(style)
    document.body.appendChild(el)
  }
  return el
}

export function renderIntervention(d: DispatchedIntervention): void {
  // The id the SDK reports outcomes with has to be the id the server persisted,
  // because the outcome handler in `/api/events` looks the row up by exactly
  // that value (`prisma.intervention.update({ where: { id: iid } })`). The
  // dispatcher deliberately keeps two ids: a session-keyed one for in-browser
  // dedup and a population-keyed `rowId` that the Intervention row is upserted
  // under, and only the row id exists in the database. Reporting the
  // session-keyed id increments nothing and writes no impression row, so the
  // bandit never sees the feedback and the A/B rate stays misleadingly empty.
  const outcomeId = d.rowId ?? d.id
  if (shown.has(d.id)) return
  shown.add(d.id)
  reportOutcome(outcomeId, 'shown')

  const target = d.targetElementId ? findElement(d.targetElementId) : null
  // Watch for the success signal - user clicks the target within 30s.
  if (target && d.type !== 'TOUR') {
    const handler = () => {
      reportOutcome(outcomeId, 'success')
      target.removeEventListener('click', handler, true)
    }
    const detach = () => { target.removeEventListener('click', handler, true); detachments.delete(detach) }
    detachments.add(detach)
    target.addEventListener('click', handler, { capture: true, once: true })
    later(detach, 30_000)
  }
  const ttl = typeof d.autoDismissMs === 'number' && d.autoDismissMs >= 0 ? d.autoDismissMs : 8000

  switch (d.type) {
    case 'OVERLAY':
      return renderOverlay(d, ttl)
    case 'HIGHLIGHT':
      return renderHighlight(target, d, ttl)
    case 'SPOTLIGHT':
      return renderSpotlight(target, d, ttl)
    case 'TOOLTIP':
      return renderTooltip(target, d, ttl)
    case 'MODAL':
      return renderModal(d, outcomeId)
    case 'BANNER':
      return renderBanner(d, ttl, outcomeId)
    case 'INLINE_HINT':
      return renderInlineHint(target, d, ttl)
    case 'TOUR':
      return renderTour(d, outcomeId)
    case 'ICON_FLASH':
      return renderIconFlash(target, ttl)
    case 'ARROW':
      return renderArrow(target, d, ttl)
    case 'CONFIRM':
      return renderConfirm(d, outcomeId)
    case 'ANNOUNCE':
      return renderAnnounce(d)
    default:
      // Unknown render type - log and skip.
      // eslint-disable-next-line no-console
      console.warn('[clarus-heal] unknown intervention render type:', (d as { type: string }).type)
  }
}

function findElement(id: ElementId): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-sh-id]')).find(el => el.getAttribute('data-sh-id') === id) ?? null
}

// ── small shared helpers ────────────────────────────────────────────────────

function makeDismissBtn(onDismiss: () => void, interventionId?: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.setAttribute('aria-label', 'Dismiss')
  Object.assign(b.style, {
    flexShrink: '0',
    border: '0',
    background: 'transparent',
    cursor: 'pointer',
    color: '#6b7280',
    fontSize: '18px',
    lineHeight: '1',
    padding: '0 4px',
  } as Partial<CSSStyleDeclaration>)
  b.textContent = '×'
  b.addEventListener('click', () => {
    if (interventionId) reportOutcome(interventionId, 'dismissed')
    onDismiss()
  })
  return b
}

function autoCleanup(el: HTMLElement, ms: number, onRemove?: () => void): void {
  if (ms <= 0) return
  later(() => {
    onRemove?.()
    el.remove()
  }, ms)
}

/**
 * Attach a one-shot ESC-key dismiss handler. Reports `dismissed` outcome and
 * removes the element.
 *
 * The listener is attached the moment an intervention renders, but it can only
 * ever fire for an element that is still in the document. A BANNER or MODAL
 * that auto-dismisses, or that the user closes with the × or the "Got it"
 * button, leaves this handler attached forever otherwise: the next keydown
 * anywhere on the page removes the stale element (a no-op, it is already gone)
 * and detaches, costing the user nothing - but until that keydown happens, every
 * intervention rendered in the session keeps one listener on the document, and
 * a long session that shows a dozen banners accumulates a dozen of them.
 *
 * So the handler detaches itself on the first keydown it sees after its own
 * element has left the document, and functions return the teardown for the
 * callers that know they are done with it (an auto-dismiss, a close button).
 */
function attachEscDismiss(el: HTMLElement, interventionId?: string, onRemove?: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    if (!document.body.contains(el)) {
      document.removeEventListener('keydown', onKey, true)
      return
    }
    if (interventionId) reportOutcome(interventionId, 'dismissed')
    onRemove?.()
    el.remove()
    document.removeEventListener('keydown', onKey, true)
  }
  document.addEventListener('keydown', onKey, true)
  const detach = () => { document.removeEventListener('keydown', onKey, true); detachments.delete(detach) }
  detachments.add(detach)
  return detach
}

/**
 * Remove an element and detach the ESC handler that was attached to it, so a
 * dismissed intervention leaves nothing on the document behind it.
 */
function removeWith(el: HTMLElement, detach: () => void): void {
  detach()
  el.remove()
}

/**
 * Trap Tab focus inside a container. Used for MODAL / CONFIRM so a screen
 * reader user can't tab out into the host page while the dialog is open.
 * Returns a teardown function the caller invokes on close.
 */
function trapFocus(el: HTMLElement): () => void {
  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const focusable = el.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
    )
    if (focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
  document.addEventListener('keydown', onKey, true)
  const detach = () => {
    document.removeEventListener('keydown', onKey, true)
    previouslyFocused?.focus?.()
    detachments.delete(detach)
  }
  detachments.add(detach)
  return detach
}

function flashRing(target: HTMLElement, kind: 'pulse' | 'glow' | 'spotlight'): HTMLElement {
  const rect = target.getBoundingClientRect()
  const ring = document.createElement('div')
  Object.assign(ring.style, {
    position: 'fixed',
    left: `${rect.left - 4}px`,
    top: `${rect.top - 4}px`,
    width: `${rect.width + 8}px`,
    height: `${rect.height + 8}px`,
    border: kind === 'glow' ? '0' : '2px solid #3b82f6',
    borderRadius: '8px',
    pointerEvents: 'none',
    zIndex: String(Z.ring),
    boxShadow:
      kind === 'glow'
        ? '0 0 30px 4px rgba(59,130,246,0.55)'
        : '0 0 0 4px rgba(59,130,246,0.25)',
    transition: 'opacity 200ms',
  } as Partial<CSSStyleDeclaration>)
  if (kind === 'pulse' && !REDUCED) ring.className = '__sh_pulse__'
  return ring
}

// ── individual renderers ────────────────────────────────────────────────────

function renderOverlay(
  d: DispatchedIntervention,
  ttl: number,
  outcomeId: string = d.rowId ?? d.id,
) {
  const card = document.createElement('div')
  card.className = '__sh_card__'
  card.setAttribute('role', 'status')
  card.setAttribute('aria-live', 'polite')
  // High-confidence interventions get a stronger left border accent.
  const conf = d.confidence ?? 0.6
  const accent = conf >= 0.85 ? '#3b82f6' : conf >= 0.6 ? '#a78bfa' : '#cbd5e1'
  Object.assign(card.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    maxWidth: '380px',
    background: 'white',
    color: '#111827',
    border: '1px solid #e5e7eb',
    borderLeft: `4px solid ${accent}`,
    borderRadius: '10px',
    padding: '14px 14px 14px 16px',
    boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
    fontFamily: FONT,
    fontSize: '14px',
    lineHeight: '1.5',
    zIndex: String(Z.card),
    pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>)
  const row = document.createElement('div')
  Object.assign(row.style, { display: 'flex', alignItems: 'flex-start', gap: '8px' } as Partial<CSSStyleDeclaration>)
  const body = document.createElement('div')
  body.style.flex = '1'
  const text = document.createElement('div')
  text.textContent = decodeHtml(d.copy)
  body.appendChild(text)
  // Secondary help copy from LLM enrichment.
  if (d.helpCopy) {
    const help = document.createElement('div')
    help.style.cssText = 'margin-top:6px;font-size:12px;color:#6b7280;'
    help.textContent = stripHtml(d.helpCopy)
    body.appendChild(help)
  }
  // Related-element shortcuts.
  if (d.relatedElementIds && d.relatedElementIds.length > 0) {
    const links = document.createElement('div')
    links.style.cssText = 'margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;'
    for (const rid of d.relatedElementIds.slice(0, 3)) {
      const el = document.querySelector<HTMLElement>(`[data-sh-id="${rid}"]`)
      if (!el) continue
      const lbl = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40)
      if (!lbl) continue
      const a = document.createElement('a')
      a.textContent = `Try “${lbl}”`
      a.style.cssText =
        'font-size:11px;color:#1d4ed8;text-decoration:underline;cursor:pointer;'
      a.addEventListener('click', (e) => {
        e.preventDefault()
        ;(el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
        ;(el as HTMLElement).focus?.()
      })
      links.appendChild(a)
    }
    if (links.children.length > 0) body.appendChild(links)
  }
  // Dev-mode diagnostic.
  if (d.diagnostic && (window as { __CLARUS_DEBUG__?: boolean }).__CLARUS_DEBUG__) {
    const diag = document.createElement('div')
    diag.style.cssText =
      'margin-top:8px;padding-top:8px;border-top:1px dashed #e5e7eb;font-family:ui-monospace,SFMono-Regular,monospace;font-size:10px;color:#6b7280;'
    diag.textContent = `${d.diagnostic.struggleType} · sev ${d.diagnostic.severity.toFixed(2)} · v${d.diagnostic.variantIndex ?? 0} · conf ${(conf).toFixed(2)}`
    body.appendChild(diag)
  }
  // Keyboard dismiss - important for users who can't reach the × by mouse.
  const detachEsc = attachEscDismiss(card, outcomeId)
  const dismiss = makeDismissBtn(() => removeWith(card, detachEsc), outcomeId)
  row.appendChild(body)
  row.appendChild(dismiss)
  card.appendChild(row)
  root().appendChild(card)
  // Lower-confidence interventions auto-dismiss faster.
  const adjustedTtl = ttl === 0 ? 0 : conf >= 0.85 ? ttl : conf >= 0.5 ? Math.max(4000, ttl * 0.75) : Math.max(3000, ttl * 0.5)
  autoCleanup(card, adjustedTtl, detachEsc)
}

function renderHighlight(target: HTMLElement | null, d: DispatchedIntervention, ttl: number) {
  if (!target) return
  const style =
    typeof d.options?.style === 'string' && (d.options.style === 'glow' || d.options.style === 'spotlight')
      ? d.options.style
      : 'pulse'
  const ring = flashRing(target, style)
  root().appendChild(ring)
  if (d.copy) {
    // Companion micro-overlay.
    renderOverlay({ ...d, autoDismissMs: ttl }, ttl)
  }
  autoCleanup(ring, ttl)
}

function renderSpotlight(target: HTMLElement | null, d: DispatchedIntervention, ttl: number) {
  if (!target) return
  const rect = target.getBoundingClientRect()
  // Full-screen dimmer with a hole punched out for the target.
  //
  // Normalize viewport coordinates and use an explicit even-odd fill rule
  // so the inner polygon cuts a hole in the fixed viewport overlay.
  const pct = (px: number, extent: number): string =>
    `${extent > 0 ? round((px / extent) * 100) : 0}%`
  const { innerWidth: vw, innerHeight: vh } = window
  const x0 = pct(rect.left - 6, vw)
  const x1 = pct(rect.right + 6, vw)
  const y0 = pct(rect.top - 6, vh)
  const y1 = pct(rect.bottom + 6, vh)
  const overlay = document.createElement('div')
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(15,23,42,0.55)',
    pointerEvents: 'none',
    zIndex: String(Z.spotlight + 1),
    clipPath: `polygon(
      evenodd,
      0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
      ${x0} ${y0},
      ${x0} ${y1},
      ${x1} ${y1},
      ${x1} ${y0},
      ${x0} ${y0}
    )`,
  } as Partial<CSSStyleDeclaration>)
  root().appendChild(overlay)
  const ring = flashRing(target, 'pulse')
  root().appendChild(ring)
  if (d.copy) renderOverlay({ ...d, autoDismissMs: ttl }, ttl)
  autoCleanup(overlay, ttl)
  autoCleanup(ring, ttl)
}

/** Trim a percentage to at most 3 decimals so the emitted `clip-path` stays readable. */
function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}

/** Keep a coordinate inside `[lo, hi]`. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}

function renderTooltip(target: HTMLElement | null, d: DispatchedIntervention, ttl: number) {
  if (!target) {
    renderOverlay(d, ttl)
    return
  }
  const rect = target.getBoundingClientRect()
  const tip = document.createElement('div')
  tip.className = '__sh_card__'
  tip.setAttribute('role', 'tooltip')
  tip.textContent = decodeHtml(d.copy)
  Object.assign(tip.style, {
    position: 'fixed',
    background: '#111827',
    color: 'white',
    padding: '8px 12px',
    borderRadius: '6px',
    fontFamily: FONT,
    fontSize: '13px',
    maxWidth: '280px',
    zIndex: String(Z.card),
    pointerEvents: 'auto',
    boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
  } as Partial<CSSStyleDeclaration>)
  // Anchor below the element, fall back to above if no room.
  const tipTop = rect.bottom + 8
  tip.style.left = `${Math.max(8, Math.min(window.innerWidth - 290, rect.left))}px`
  tip.style.top = `${tipTop > window.innerHeight - 60 ? rect.top - 50 : tipTop}px`
  root().appendChild(tip)
  // Highlight the target with a ring too.
  const ring = flashRing(target, 'pulse')
  root().appendChild(ring)
  autoCleanup(tip, ttl)
  autoCleanup(ring, ttl)
}

function renderModal(d: DispatchedIntervention, outcomeId: string = d.id) {
  const backdrop = document.createElement('div')
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(15,23,42,0.55)',
    zIndex: String(Z.modal),
    pointerEvents: 'auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    fontFamily: FONT,
  } as Partial<CSSStyleDeclaration>)
  const card = document.createElement('div')
  card.className = '__sh_card__'
  // alertdialog is the right ARIA role here - it implies the user must acknowledge
  // before continuing, vs `dialog` which is more passive. CONFIRM uses the same role.
  card.setAttribute('role', 'alertdialog')
  card.setAttribute('aria-modal', 'true')
  if (d.title) card.setAttribute('aria-labelledby', '__sh_modal_title__')
  card.setAttribute('aria-describedby', '__sh_modal_body__')
  Object.assign(card.style, {
    background: 'white',
    color: '#111827',
    borderRadius: '12px',
    padding: '24px',
    maxWidth: '440px',
    width: '100%',
    boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
  } as Partial<CSSStyleDeclaration>)
  if (d.title) {
    const h = document.createElement('h2')
    h.id = '__sh_modal_title__'
    h.textContent = d.title
    Object.assign(h.style, { fontSize: '18px', fontWeight: '600', margin: '0 0 8px' } as Partial<CSSStyleDeclaration>)
    card.appendChild(h)
  }
  const body = document.createElement('div')
  body.id = '__sh_modal_body__'
  body.textContent = decodeHtml(d.copy)
  body.style.fontSize = '14px'
  body.style.lineHeight = '1.5'
  card.appendChild(body)
  const actions = document.createElement('div')
  Object.assign(actions.style, {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end',
    marginTop: '16px',
  } as Partial<CSSStyleDeclaration>)
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = 'Got it'
  Object.assign(close.style, {
    padding: '8px 14px',
    borderRadius: '6px',
    border: '0',
    background: '#111827',
    color: 'white',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
  } as Partial<CSSStyleDeclaration>)
  let teardownFocus: (() => void) | null = null
  let teardownEsc: (() => void) | null = null
  const dismiss = () => {
    teardownFocus?.()
    reportOutcome(outcomeId, 'dismissed')
    removeWith(backdrop, () => teardownEsc?.())
  }
  close.addEventListener('click', dismiss)
  actions.appendChild(close)
  card.appendChild(actions)
  backdrop.appendChild(card)
  root().appendChild(backdrop)
  // Trap focus + restore on close, then focus the primary button.
  teardownFocus = trapFocus(card)
  close.focus()
  // ESC key closes.
  teardownEsc = attachEscDismiss(backdrop, outcomeId, () => teardownFocus?.())
}

function renderBanner(d: DispatchedIntervention, ttl: number, outcomeId: string = d.id) {
  const bg =
    d.options?.severity === 'error'
      ? '#fee2e2'
      : d.options?.severity === 'warning'
        ? '#fef3c7'
        : '#dbeafe'
  const fg =
    d.options?.severity === 'error'
      ? '#991b1b'
      : d.options?.severity === 'warning'
        ? '#854d0e'
        : '#1e3a8a'
  const banner = document.createElement('div')
  banner.className = '__sh_card__'
  banner.setAttribute('role', 'status')
  Object.assign(banner.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    background: bg,
    color: fg,
    padding: '10px 16px',
    fontFamily: FONT,
    fontSize: '14px',
    zIndex: String(Z.banner),
    pointerEvents: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    borderBottom: '1px solid rgba(0,0,0,0.08)',
  } as Partial<CSSStyleDeclaration>)
  const text = document.createElement('div')
  text.style.flex = '1'
  text.textContent = decodeHtml(d.copy)
  banner.appendChild(text)
  const detachEsc = attachEscDismiss(banner, outcomeId)
  banner.appendChild(makeDismissBtn(() => removeWith(banner, detachEsc), outcomeId))
  root().appendChild(banner)
  autoCleanup(banner, ttl, detachEsc)
}

function renderInlineHint(target: HTMLElement | null, d: DispatchedIntervention, ttl: number) {
  if (!target) {
    renderOverlay(d, ttl)
    return
  }
  const rect = target.getBoundingClientRect()
  const hint = document.createElement('div')
  hint.className = '__sh_card__'
  hint.textContent = decodeHtml(d.copy)
  Object.assign(hint.style, {
    position: 'fixed',
    background: '#fef3c7',
    color: '#854d0e',
    padding: '4px 8px',
    borderRadius: '4px',
    fontFamily: FONT,
    fontSize: '12px',
    fontWeight: '500',
    maxWidth: '300px',
    left: `${rect.left}px`,
    top: `${rect.bottom + 4}px`,
    zIndex: String(Z.card),
    pointerEvents: 'auto',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  } as Partial<CSSStyleDeclaration>)
  root().appendChild(hint)
  autoCleanup(hint, ttl)
}

function renderTour(d: DispatchedIntervention, outcomeId: string = d.id) {
  let steps: TourStep[] = [{ title: d.title || 'A little guidance', copy: d.copy, targetElementId: d.targetElementId ?? undefined }]
  if (typeof d.options?.steps === 'string') {
    try {
      if (d.options.steps.length > 100_000) return
      steps = JSON.parse(d.options.steps) as TourStep[]
    } catch { return }
  }
  try {
    startTour({ steps, onFinish: () => reportOutcome(outcomeId, 'success'), onDismiss: () => reportOutcome(outcomeId, 'dismissed') })
  } catch { /* Malformed server tour data must not break the host page. */ }
}

function renderIconFlash(target: HTMLElement | null, ttl: number) {
  if (!target) return
  const original = target.style.transition
  target.style.transition = 'background 200ms'
  target.classList.add('__sh_flash__')
  later(() => {
    target.classList.remove('__sh_flash__')
    target.style.transition = original
  }, ttl > 0 ? ttl : 2400)
}

function renderArrow(target: HTMLElement | null, d: DispatchedIntervention, ttl: number) {
  if (!target) {
    renderOverlay(d, ttl)
    return
  }
  const rect = target.getBoundingClientRect()
  const arrow = document.createElement('div')
  arrow.textContent = '↓'
  // Anchored above the element and pointing down at it. Above the fold there is
  // no room for that, and an arrow rendered at a negative offset is simply not
  // on the screen - the user gets a hint with no arrow and no way to tell one
  // was meant to be there. Below the element reads just as well (it still
  // points at it from the nearest side) and is always on screen.
  const GUTTER = 36
  const above = rect.top - GUTTER
  const below = rect.bottom + 4
  const top = above >= 0 ? above : Math.min(below, Math.max(0, window.innerHeight - GUTTER))
  Object.assign(arrow.style, {
    position: 'fixed',
    left: `${clamp(rect.left + rect.width / 2 - 12, 0, window.innerWidth - 24)}px`,
    top: `${top}px`,
    fontSize: '28px',
    color: '#3b82f6',
    fontWeight: 'bold',
    zIndex: String(Z.arrow),
    pointerEvents: 'none',
    textShadow: '0 2px 6px rgba(59,130,246,0.5)',
  } as Partial<CSSStyleDeclaration>)
  if (!REDUCED) {
    arrow.style.transition = 'transform 600ms ease-in-out'
    let up = false
    const interval = window.setInterval(() => {
      arrow.style.transform = up ? 'translateY(0)' : 'translateY(-6px)'
      up = !up
    }, 600)
    later(() => window.clearInterval(interval), ttl > 0 ? ttl : 6000)
  }
  root().appendChild(arrow)
  if (d.copy) renderOverlay(d, ttl)
  autoCleanup(arrow, ttl > 0 ? ttl : 6000)
}

function renderConfirm(d: DispatchedIntervention, outcomeId: string = d.id) {
  // A confirm is an overlay with a "Yes" CTA. Same chrome as overlay. The
  // overlay's own default would be right for a dispatched intervention, but the
  // id is threaded explicitly so the reported outcome is the one the caller
  // resolved - a confirm served from the cache still has to report its row.
  renderOverlay(d, 0, outcomeId)
}

function renderAnnounce(d: DispatchedIntervention) {
  // Hidden aria-live region only - no visual.
  const region = document.createElement('div')
  region.setAttribute('role', 'status')
  region.setAttribute(
    'aria-live',
    d.options?.level === 'assertive' ? 'assertive' : 'polite',
  )
  region.style.position = 'absolute'
  region.style.left = '-9999px'
  region.textContent = stripHtml(d.copy)
  root().appendChild(region)
  later(() => region.remove(), 4000)
}

function decodeHtml(s: string): string {
  // Decode the library's typography entities. Dynamic copy is assigned to
  // textContent, so validation messages never become executable markup.
  return s
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&hellip;/g, '…')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
}
function stripHtml(s: string): string {
  return decodeHtml(s).replace(/<[^>]+>/g, '')
}

export type { DispatchedIntervention, InterventionRenderType }
