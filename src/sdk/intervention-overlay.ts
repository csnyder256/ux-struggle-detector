/**
 * Minimal overlay renderer - shows a "Looks like you're trying to ___" toast
 * at the bottom-right and draws a highlight ring around the recommended
 * target element. Always dismissible. Auto-removes after 8 seconds.
 *
 * This is the simplest of the three intervention types from the plan
 * (OVERLAY); DOM mutations and behavior overrides will arrive with the
 * full intervention engine (Phase 8).
 */

import type { ElementId } from '../lib/types/ui-map'

const OVERLAY_TIMEOUT_MS = 8000

export function showOverlay(targetElementId: ElementId | null, copy: string): void {
  const target = targetElementId
    ? document.querySelector<HTMLElement>(`[data-sh-id="${targetElementId}"]`)
    : null

  const card = document.createElement('div')
  card.setAttribute('role', 'status')
  card.setAttribute('aria-live', 'polite')
  Object.assign(card.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    maxWidth: '360px',
    background: 'white',
    color: '#111827',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '14px 14px 14px 16px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontSize: '14px',
    lineHeight: '1.45',
    zIndex: '999999',
  } as Partial<CSSStyleDeclaration>)
  card.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:8px;">
      <div style="flex:1;"></div>
      <button type="button" aria-label="Dismiss" style="
        flex-shrink:0;border:0;background:transparent;cursor:pointer;
        color:#6b7280;font-size:18px;line-height:1;padding:0 4px;">&times;</button>
    </div>
  `
  const text = card.firstElementChild!.firstElementChild as HTMLDivElement
  text.textContent = copy

  const dismissBtn = card.querySelector('button')
  let ring: HTMLDivElement | null = null

  function teardown() {
    card.remove()
    ring?.remove()
  }

  dismissBtn?.addEventListener('click', teardown)
  document.body.appendChild(card)

  if (target) {
    const rect = target.getBoundingClientRect()
    ring = document.createElement('div')
    Object.assign(ring.style, {
      position: 'fixed',
      left: `${rect.left - 4}px`,
      top: `${rect.top - 4}px`,
      width: `${rect.width + 8}px`,
      height: `${rect.height + 8}px`,
      border: '2px solid #3b82f6',
      borderRadius: '6px',
      pointerEvents: 'none',
      zIndex: '999998',
      boxShadow: '0 0 0 4px rgba(59, 130, 246, 0.25)',
      transition: 'opacity 200ms',
    } as Partial<CSSStyleDeclaration>)
    document.body.appendChild(ring)
  }

  window.setTimeout(teardown, OVERLAY_TIMEOUT_MS)
}
