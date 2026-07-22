/**
 * HTTP crawler - fetches a URL, parses the rendered HTML, extracts
 * interactive elements via the same regex used by the universal parser.
 *
 * MVP scope: single URL, no link-following, no headless browser. Works
 * great for SSR pages (Hugo / Jekyll / Eleventy / FastHTML / Astro static
 * builds) and pre-rendered marketing pages. SPAs will return little since
 * their initial HTML is a shell - those need a real headless browser, which
 * is the Playwright phase later in the plan.
 *
 * Output: a UIMap with elements and (currently) no routes - the source URL
 * is recorded as `entryPoints` on a single MappedRoute keyed to the URL's
 * pathname.
 */

import {
  hashElementId,
  hashLabel,
  type ElementExtraction,
  type ElementType,
  type MappedElement,
  type MappedRoute,
  type Parser,
  type ParseInput,
  type RouteExtraction,
  type SemanticRole,
  type UIMap,
  type ValidationRules,
} from '@/lib/types/ui-map'

const TIMEOUT_MS = 15_000

export interface CrawlInput {
  orgId: string
  url: string
}

export interface CrawlResult {
  uiMap: UIMap
  fetched: {
    url: string
    status: number
    bytes: number
    /**
     * The raw HTML body that was parsed. Exposed so callers can apply
     * heuristics like `looksLikeSpaShell()` without re-fetching.
     */
    html?: string
  }
}

export class HttpCrawler implements Parser {
  readonly id = 'http-crawler'

  /**
   * The Parser interface uses a repo source. The HTTP crawler doesn't have
   * a repo - call `crawlUrl()` directly instead.
   */
  async parse(_input: ParseInput): Promise<UIMap> {
    throw new Error('HttpCrawler does not support source.kind === "repo". Call crawlUrl() instead.')
  }

  async crawlUrl(input: CrawlInput): Promise<CrawlResult> {
    const html = await fetchPage(input.url)
    const uiMap = await buildMapFromHtml(input.orgId, input.url, html.body)
    return {
      uiMap,
      fetched: { url: input.url, status: html.status, bytes: html.body.length, html: html.body },
    }
  }
}

async function fetchPage(url: string): Promise<{ status: number; body: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; ClarusHealCrawler/0.1; +https://clarus-heal.example/crawler)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    })
    const body = await res.text()
    return { status: res.status, body }
  } finally {
    clearTimeout(timer)
  }
}

const TAGS = ['button', 'input', 'textarea', 'select', 'form', 'a'] as const

const ELEMENT_TYPE_MAP: Record<string, ElementType> = {
  button: 'BUTTON',
  input: 'INPUT',
  textarea: 'INPUT',
  select: 'SELECT',
  form: 'FORM',
  a: 'LINK',
}

interface TagMatch {
  tag: string
  attrs: Record<string, string>
  innerText: string
  index: number
  fullMatch: string
}

function* findTags(source: string): Generator<TagMatch> {
  const pattern = new RegExp(`<(${TAGS.join('|')})\\b([^>]*)>`, 'gi')
  let m: RegExpExecArray | null
  while ((m = pattern.exec(source)) !== null) {
    const tag = m[1]!.toLowerCase()
    const attrs = parseAttrs(m[2] ?? '')
    let innerText = ''
    if (tag !== 'input') {
      const close = source.indexOf(`</${tag}`, m.index + m[0].length)
      if (close >= 0) innerText = source.slice(m.index + m[0].length, close)
    }
    yield { tag, attrs, innerText, index: m.index, fullMatch: m[0] }
  }
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([:@a-zA-Z_][\w:.\-@]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    const name = m[1]!
    const value = m[2] ?? m[3] ?? m[4] ?? ''
    out[name] = value
  }
  return out
}

export async function buildMapFromHtml(
  orgId: string,
  url: string,
  html: string,
): Promise<UIMap> {
  const elements: MappedElement[] = []
  const counts: Record<string, number> = {}
  const u = new URL(url)
  const filePath = `crawler:${u.host}${u.pathname}`

  // Track enclosing form for context.
  const formStack: Array<{ id?: string; name?: string; action?: string; closeAt: number }> = []

  for (const m of findTags(html)) {
    while (formStack.length > 0 && formStack[formStack.length - 1]!.closeAt <= m.index) {
      formStack.pop()
    }
    if (m.tag === 'form') {
      const closeAt = html.indexOf('</form', m.index + m.fullMatch.length)
      formStack.push({
        id: m.attrs.id,
        name: m.attrs.name,
        action: m.attrs.action,
        closeAt: closeAt === -1 ? Infinity : closeAt,
      })
    }
    const elementType = ELEMENT_TYPE_MAP[m.tag]
    if (!elementType) continue
    counts[m.tag] = (counts[m.tag] ?? 0) + 1
    const idx = counts[m.tag]! - 1
    const descriptor = `${m.tag}[${idx}]`

    const labelRaw = pickLabel(m, html)
    const labelHash = labelRaw ? await hashLabel(labelRaw) : ''
    const id = await hashElementId({ orgId, filePath, nodeDescriptor: descriptor })

    const extraction: ElementExtraction = {}
    const validation = readValidationFromCrawl(m.attrs, m.tag)
    if (Object.keys(validation).length > 0) extraction.validation = validation
    if (m.attrs.placeholder) extraction.placeholder = m.attrs.placeholder
    if (m.attrs.title) extraction.helpText = m.attrs.title
    if (m.attrs['aria-describedby']) extraction.ariaDescription = m.attrs['aria-describedby']
    if (m.attrs.name) extraction.name = m.attrs.name
    if (m.attrs.value && (m.tag === 'input' || m.tag === 'textarea')) {
      extraction.defaultValue = m.attrs.value
    }
    if (m.tag === 'form' && m.attrs.action) extraction.endpoint = m.attrs.action
    extraction.positionInParent = idx
    if (formStack.length > 0) {
      const top = formStack[formStack.length - 1]!
      extraction.formContext = top.id ?? top.name ?? '(unnamed-form)'
    }
    const role = inferCrawlSemanticRole(m.tag, labelRaw, m.attrs)
    if (role) extraction.semanticRole = role
    if (role === 'DANGER' || role === 'DELETE' || role === 'LOGOUT') extraction.destructive = true

    elements.push({
      id,
      filePath,
      componentName: null,
      elementType,
      labelRaw,
      labelHash,
      handlerFunction: null,
      routeTarget: m.attrs['href'] ?? null,
      extraction,
    })
  }

  const routeExtraction = extractPageMetadata(html, url)
  const routes: MappedRoute[] = [
    {
      path: u.pathname || '/',
      parentPath: null,
      entryPoints: [url],
      extraction: routeExtraction,
    },
  ]

  return {
    schemaVersion: 1,
    orgId,
    elements,
    routes,
  }
}

function readValidationFromCrawl(
  attrs: Record<string, string>,
  tag: string,
): ValidationRules {
  const v: ValidationRules = {}
  if ('required' in attrs) v.required = true
  if ('disabled' in attrs) v.disabled = true
  if ('readonly' in attrs) v.readonly = true
  if (attrs.minlength) {
    const n = Number(attrs.minlength)
    if (!Number.isNaN(n)) v.minLength = n
  }
  if (attrs.maxlength) {
    const n = Number(attrs.maxlength)
    if (!Number.isNaN(n)) v.maxLength = n
  }
  if (attrs.min) v.min = Number.isNaN(Number(attrs.min)) ? attrs.min : Number(attrs.min)
  if (attrs.max) v.max = Number.isNaN(Number(attrs.max)) ? attrs.max : Number(attrs.max)
  if (attrs.pattern) v.pattern = attrs.pattern
  if (attrs.step) v.step = Number.isNaN(Number(attrs.step)) ? attrs.step : Number(attrs.step)
  if (tag === 'input' && attrs.type) v.inputType = attrs.type
  return v
}

const CRAWL_ROLE_KEYWORDS: Array<[SemanticRole, RegExp]> = [
  ['SUBMIT', /^(submit|save|create|continue|next|sign\s?up|register|apply|send|publish|post)\b/i],
  ['CANCEL', /^(cancel|close|discard|nevermind|back|skip)\b/i],
  ['DANGER', /^(delete|remove|destroy|drop|wipe|clear|deactivate)\b/i],
  ['DISMISS', /^(dismiss|close|×|✕|hide)\b/i],
  ['RETRY', /^(retry|try again|reload|refresh)\b/i],
  ['HELP', /^(help|support|contact|faq|docs|documentation)\b/i],
  ['SEARCH', /^(search|find|lookup)\b/i],
  ['LOGIN', /^(log\s?in|sign\s?in)\b/i],
  ['LOGOUT', /^(log\s?out|sign\s?out)\b/i],
  ['PAYMENT', /^(pay|checkout|purchase|buy)\b/i],
]

function inferCrawlSemanticRole(
  tag: string,
  labelRaw: string | null,
  attrs: Record<string, string>,
): SemanticRole | null {
  if (tag === 'input' && attrs.type === 'submit') return 'SUBMIT'
  if (tag === 'button' && attrs.type === 'submit') return 'SUBMIT'
  if (tag === 'a' && (attrs.href === '#help' || attrs.href === '/help')) return 'HELP'
  if (tag === 'a' && (attrs.href === '#search' || attrs.href === '/search')) return 'SEARCH'
  if (tag === 'a') return 'NAV'
  if (labelRaw) {
    for (const [role, re] of CRAWL_ROLE_KEYWORDS) {
      if (re.test(labelRaw.trim())) return role
    }
  }
  const cls = (attrs.class ?? '').toLowerCase()
  if (cls.includes('danger') || cls.includes('destructive')) return 'DANGER'
  if (cls.includes('primary') || cls.includes('cta')) return 'PRIMARY'
  return null
}

function extractPageMetadata(html: string, url: string): RouteExtraction {
  const out: RouteExtraction = {}
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch) {
    const t = titleMatch[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (t) out.title = t.slice(0, 200)
  }
  if (!out.title) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    if (h1) {
      const t = h1[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (t) out.title = t.slice(0, 200)
    }
  }
  // Meta description / og:description
  const meta =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
  if (meta) out.description = meta[1]?.slice(0, 500)

  // Sections (h2 / h3)
  const sections: string[] = []
  const headingRe = /<h(?:2|3)[^>]*>([\s\S]*?)<\/h(?:2|3)>/gi
  let h: RegExpExecArray | null
  while ((h = headingRe.exec(html)) !== null) {
    const text = h[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (text && sections.length < 12) sections.push(text.slice(0, 120))
  }
  if (sections.length > 0) out.sections = sections

  // Auth heuristic - login form on page implies the page is unauth, but the
  // presence of "logout" or "session" implies auth-gated. Skip - too noisy
  // for crawler-level inference. Leave authRequired unset.

  // OpenGraph fallback for title / description.
  if (!out.title) {
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    if (ogTitle) out.title = ogTitle[1]?.slice(0, 200)
  }
  if (!out.description) {
    const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    if (ogDesc) out.description = ogDesc[1]?.slice(0, 500)
  }

  // schema.org JSON-LD - pulls out Article / Product / WebPage richer info.
  const jsonLdMatches = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )
  const ldBlocks: Array<Record<string, unknown>> = []
  for (const m of jsonLdMatches) {
    try {
      const parsed = JSON.parse(m[1] ?? 'null')
      if (parsed && typeof parsed === 'object') {
        const arr = Array.isArray(parsed) ? parsed : [parsed]
        for (const item of arr) {
          if (item && typeof item === 'object') ldBlocks.push(item as Record<string, unknown>)
        }
      }
    } catch {
      // Skip malformed JSON-LD.
    }
  }
  if (ldBlocks.length > 0) {
    // Pull a name / description if the host site exposed one.
    for (const b of ldBlocks) {
      if (!out.title && typeof b.name === 'string') out.title = String(b.name).slice(0, 200)
      if (!out.description && typeof b.description === 'string') {
        out.description = String(b.description).slice(0, 500)
      }
    }
  }

  out.sourceFile = `crawler:${new URL(url).host}${new URL(url).pathname}`
  return out
}

function pickLabel(m: TagMatch, html: string): string | null {
  const aria = m.attrs['aria-label']
  if (aria) return aria
  const title = m.attrs['title']
  if (title) return title
  const ph = m.attrs['placeholder']
  if (ph) return ph
  const value = m.attrs['value']
  if (value && (m.tag === 'input' || m.tag === 'button')) return value
  if (m.innerText) {
    const text = m.innerText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (text.length > 0) return text.slice(0, 200)
  }
  // Fallback: peek at the next 80 chars of source.
  const after = html.slice(m.index, m.index + 200)
  const stripped = after.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return stripped.length > 0 ? stripped.slice(0, 80) : null
}
