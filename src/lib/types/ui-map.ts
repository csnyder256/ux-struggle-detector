/**
 * UI Map - the contract between the static mapper, the build-time injector,
 * and the runtime SDK fallback.
 *
 * THIS FILE IS THE SINGLE SOURCE OF TRUTH FOR ELEMENT ID HASHING.
 * If any of the three downstream consumers (parser, Babel plugin, SDK) implements
 * a different hash, runtime events will not match static elements and the system
 * silently degrades. Always import the hash function from here.
 *
 * The hash is built on the global Web Crypto API (available in Node ≥ 19 and all
 * modern browsers), so the same function runs in build tooling, edge functions,
 * and the customer's browser.
 */

export type ElementId = `sh_${string}`

export type ElementType = 'BUTTON' | 'INPUT' | 'SELECT' | 'FORM' | 'LINK' | 'CUSTOM'

/**
 * A stable AST path descriptor. Examples:
 *   "Component>div[0]>form[0]>button[2]"
 *   "RootLayout>main[0]>section[1]>a[0]"
 *
 * Critically, this is NOT a byte offset - it survives reformatting, comment
 * additions, and unrelated edits in the same file. Siblings of the same tag
 * are disambiguated by their index among same-tag siblings.
 *
 * If a component is moved to a new file or renamed, its ElementId changes.
 * That is by design; we add a `renamed_from` pointer in a later phase when
 * we can detect renames with high confidence.
 */
export type StableNodeDescriptor = string

export interface ElementIdInputs {
  orgId: string
  filePath: string
  nodeDescriptor: StableNodeDescriptor
}

/**
 * Compute the deterministic ElementId for a UI element.
 *
 * Format: `sh_<32-char hex>` (16 bytes of SHA-256, hex-encoded).
 *
 * @example
 *   await hashElementId({ orgId: "org_x", filePath: "src/Form.tsx",
 *     nodeDescriptor: "Form>button[0]" })
 *   // → "sh_4f1c3e2a..."
 */
export async function hashElementId(inputs: ElementIdInputs): Promise<ElementId> {
  const canonical = `${inputs.orgId}:${inputs.filePath}:${inputs.nodeDescriptor}`
  const data = new TextEncoder().encode(canonical)
  const buf = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(buf).slice(0, 16)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `sh_${hex}` as ElementId
}

export function isElementId(value: string): value is ElementId {
  return /^sh_[0-9a-f]{32}$/.test(value)
}

/**
 * Hash an element's user-facing label for matching when the raw label is not
 * stored due to privacy settings. Always normalize to NFC before hashing.
 */
export async function hashLabel(text: string): Promise<string> {
  const data = new TextEncoder().encode(text.normalize('NFC'))
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

// ─────────────────────────────────────────────────────────────────────────────
// UIMap - the output of any static mapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inferred semantic role of an interactive element. Used by the dispatcher to
 * pick template copy and by the detector to attribute struggle types
 * (e.g. retry / dismiss / help). Anything not on this list becomes 'OTHER'.
 */
export type SemanticRole =
  | 'SUBMIT'
  | 'CANCEL'
  | 'DANGER'
  | 'PRIMARY'
  | 'SECONDARY'
  | 'NAV'
  | 'SEARCH'
  | 'FILTER'
  | 'MENU'
  | 'DISMISS'
  | 'RETRY'
  | 'HELP'
  | 'CONFIRM'
  | 'TOGGLE'
  | 'EXPAND'
  | 'EDIT'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'PAYMENT'
  | 'OTHER'

/**
 * Validation rules pulled off the source - used by the detector for
 * REQUIRED_MISSED / FORMAT_ERROR / PASSWORD_RETRY rules and by the
 * intervention dispatcher to give correct guidance copy.
 */
export interface ValidationRules {
  required?: boolean
  minLength?: number
  maxLength?: number
  pattern?: string
  min?: number | string
  max?: number | string
  /** HTML5 input type when the element is an INPUT (text/email/password/number/etc). */
  inputType?: string
  /** Step for numeric inputs. */
  step?: number | string
  /** Whether the field is read-only. */
  readonly?: boolean
  /** Whether the field is disabled. */
  disabled?: boolean
}

/**
 * Rich extraction data for an element. Stored in the DB as JSON so we can
 * keep adding fields without migration churn - the SDK + dispatcher both
 * read this opportunistically.
 */
export interface ElementExtraction {
  ariaDescription?: string
  placeholder?: string
  defaultValue?: string
  helpText?: string
  semanticRole?: SemanticRole
  /** Form name/id this element is part of. */
  formContext?: string
  /** Sibling element IDs in the same form/group, ordered. */
  siblingIds?: ElementId[]
  /** 0-based index among siblings of the same tag in the parent. */
  positionInParent?: number
  /** name attribute (for inputs / form fields). */
  name?: string
  validation?: ValidationRules
  /** Inferred destructiveness - affects whether interventions can confirm/auto-fix. */
  destructive?: boolean
  /** Free-form tags from the parser (e.g. "icon-only", "primary-cta"). */
  tags?: string[]
  /** API endpoint inferred from form action / handler analysis. */
  endpoint?: string
}

export interface MappedElement {
  id: ElementId
  filePath: string
  componentName: string | null
  elementType: ElementType
  labelRaw: string | null
  labelHash: string
  handlerFunction: string | null
  routeTarget: string | null
  /** Rich extraction data. Optional but populated by all parsers. */
  extraction?: ElementExtraction
}

export interface RouteExtraction {
  /** Page title from <h1>, <title>, or metadata export. */
  title?: string
  /** Short description from meta tags or the first paragraph. */
  description?: string
  /** Section headings (h2 / h3) discovered on the page. */
  sections?: string[]
  /** True if the page is gated by an auth check. Heuristic. */
  authRequired?: boolean
  /** Layout/template name when applicable. */
  layout?: string
  /** Source file path that owns this route. */
  sourceFile?: string
  /** Dynamic segment names (e.g. ['slug', 'id']). */
  params?: string[]
}

export interface MappedRoute {
  path: string
  parentPath: string | null
  entryPoints: string[]
  extraction?: RouteExtraction
}

export interface UIMap {
  schemaVersion: 1
  orgId: string
  elements: MappedElement[]
  routes: MappedRoute[]
  /** Inverse index for O(1) "all elements on route X" lookups. */
  elementsByRoute?: Record<string, ElementId[]>
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser interface - every framework-specific parser implements this.
// React/Babel is the reference implementation. Vue, Svelte, Angular plug in
// as separate packages without touching the core.
// ─────────────────────────────────────────────────────────────────────────────

export type ParseSource =
  | { kind: 'repo'; rootDir: string }
  | { kind: 'files'; files: Array<{ path: string; contents: string }> }

export interface ParseInput {
  orgId: string
  source: ParseSource
}

export interface Parser {
  /** Stable identifier (e.g., "react", "vue", "svelte"). */
  id: string
  parse(input: ParseInput): Promise<UIMap>
}

// ─────────────────────────────────────────────────────────────────────────────
// Semantic context hashing - Phase 2 cache key
// ─────────────────────────────────────────────────────────────────────────────

export interface SemanticContext {
  platformDescription: string
  route: string
  parentComponent: string | null
  /** Element IDs of immediate siblings (same parent in the AST). */
  siblings: ElementId[]
  /** The element's own minimal info that still affects semantics. */
  selfDescriptor: string
}

/**
 * Cache key for the LLM-enriched UISemantic record.
 * Re-enriching is triggered when the context hash changes - including when
 * siblings, route, or parent component change, even if the element's own
 * code did not. This is the difference between a cheap and an expensive
 * mapping operation.
 */
export async function hashSemanticContext(ctx: SemanticContext): Promise<string> {
  const canonical = JSON.stringify({
    p: ctx.platformDescription,
    r: ctx.route,
    pc: ctx.parentComponent,
    s: [...ctx.siblings].sort(),
    sd: ctx.selfDescriptor,
  })
  const data = new TextEncoder().encode(canonical)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}
