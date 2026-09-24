/**
 * Element ID resolution at runtime.
 *
 * Strategy:
 *   1. If the build-time Babel/SWC plugin has injected `data-sh-id`, use that.
 *      This is the path the system is designed for; IDs match the static map.
 *   2. Otherwise, compute a runtime ID using a DOM-derived stable descriptor.
 *      This is the documented fallback - works without the plugin, but loses
 *      stability across refactors that the AST-derived ID would have caught.
 *
 * Both paths import `hashElementId` from `lib/types/ui-map` so the hash is
 * identical to whatever the static mapper computes.
 */

import { hashElementId, type ElementId, isElementId } from '../lib/types/ui-map'
import { routeFromLocation } from './route'

const MAX_DEPTH = 20

/**
 * Sibling-index path from this element up to (but excluding) the body.
 * Format mirrors the canonical AST descriptor: `tag[idx]>tag[idx]>...`.
 */
export function describeNode(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  let depth = 0
  while (cur && cur.parentElement && depth < MAX_DEPTH) {
    const tag = cur.tagName.toLowerCase()
    let idx = 0
    let sib = cur.previousElementSibling
    while (sib) {
      if (sib.tagName === cur.tagName) idx++
      sib = sib.previousElementSibling
    }
    parts.unshift(`${tag}[${idx}]`)
    cur = cur.parentElement
    if (cur === document.body) break
    depth++
  }
  return parts.join('>')
}

export async function resolveElementId(
  orgId: string,
  el: Element,
): Promise<ElementId> {
  const attr = el.getAttribute('data-sh-id')
  if (attr && isElementId(attr)) return attr

  // Route, not pathname: in a hash-routed app every screen shares one
  // pathname, and same-position elements on different screens would collide.
  const filePath = routeFromLocation(window.location)
  const nodeDescriptor = describeNode(el)
  return hashElementId({ orgId, filePath, nodeDescriptor })
}
