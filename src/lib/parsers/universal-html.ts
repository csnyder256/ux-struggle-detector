/**
 * Universal HTML/template parser - regex-based extraction of interactive
 * elements from any framework's source files.
 *
 * Used as the parser for every family that doesn't have a dedicated AST
 * parser yet (Vue, Svelte, Angular, Astro, Solid, Qwik, Lit, Polymer,
 * Ember, Dojo, Mithril, Marko, Aurelia, Alpine, HTMX, FastHTML, all SSGs,
 * and the build-tool fallbacks). Less accurate than a real AST parser, but
 * it produces UIElements for the dashboard right away - far better than the
 * "detection only" stub.
 *
 * Extension coverage:
 *   .vue, .svelte, .astro, .marko, .html, .htm, .liquid, .erb, .njk, .hbs,
 *   .mustache, .pug, .ejs, .twig, .jinja, .j2, .md, .mdx, .razor, .cshtml,
 *   .py (FastHTML), .ex/.heex (LiveView), .leex
 *
 * What it extracts:
 *   <button>, <input>, <select>, <textarea>, <form>, <a href=...>
 *   plus elements with hx-* attributes (HTMX) and x-on:* / @click (Alpine)
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  hashElementId,
  hashLabel,
  type ElementExtraction,
  type ElementType,
  type MappedElement,
  type MappedRoute,
  type Parser,
  type ParseInput,
  type SemanticRole,
  type UIMap,
  type ValidationRules,
} from '@/lib/types/ui-map'

const TEMPLATE_EXTS = new Set([
  '.html',
  '.htm',
  '.vue',
  '.svelte',
  '.astro',
  '.marko',
  '.liquid',
  '.erb',
  '.njk',
  '.hbs',
  '.mustache',
  '.pug',
  '.ejs',
  '.twig',
  '.jinja',
  '.j2',
  '.md',
  '.mdx',
  '.razor',
  '.cshtml',
  '.py',
  '.ex',
  '.heex',
  '.leex',
  '.eex',
])

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.git',
  '.cache',
  '.parcel-cache',
  '.turbo',
  'dist',
  'build',
  'out',
  'coverage',
  'public',
  'static',
])

const MAX_FILES = 3000

interface CollectedElement {
  filePath: string
  descriptor: string
  elementType: ElementType
  labelRaw: string | null
  handlerFunction: string | null
  routeTarget: string | null
  extraction: ElementExtraction
}

export class UniversalHtmlParser implements Parser {
  constructor(public readonly id: string = 'universal-html') {}

  async parse(input: ParseInput): Promise<UIMap> {
    if (input.source.kind !== 'repo') {
      throw new Error('UniversalHtmlParser requires source.kind === "repo".')
    }
    const rootDir = input.source.rootDir
    const orgId = input.orgId

    const files = await collectTemplateFiles(rootDir)
    const collected: CollectedElement[] = []
    for (const f of files) {
      try {
        const contents = await fs.readFile(f.absPath, 'utf-8')
        collected.push(...extractFromTemplate(f.relPath, contents))
      } catch {
        // Skip unreadable files.
      }
    }

    const elements: MappedElement[] = []
    for (const c of collected) {
      const id = await hashElementId({
        orgId,
        filePath: c.filePath,
        nodeDescriptor: c.descriptor,
      })
      const labelHash = c.labelRaw ? await hashLabel(c.labelRaw) : ''
      elements.push({
        id,
        filePath: c.filePath,
        componentName: null,
        elementType: c.elementType,
        labelRaw: c.labelRaw,
        labelHash,
        handlerFunction: c.handlerFunction,
        routeTarget: c.routeTarget,
        extraction: c.extraction,
      })
    }

    const routes = await detectRoutes(rootDir)

    return {
      schemaVersion: 1,
      orgId,
      elements,
      routes,
    }
  }
}

// ── Route detection across non-React frameworks ─────────────────────────────

const ROUTE_DIRS: Array<{
  dir: string
  mode: 'file-based' | 'content'
  extensions: string[]
  /** Files / extensions to skip even when present in the dir. */
  skip?: string[]
}> = [
  // Nuxt / Vue file-based pages
  { dir: 'pages', mode: 'file-based', extensions: ['.vue', '.js', '.ts'] },
  { dir: 'src/pages', mode: 'file-based', extensions: ['.vue', '.js', '.ts'] },
  // SvelteKit
  { dir: 'src/routes', mode: 'file-based', extensions: ['.svelte', '.js', '.ts'] },
  { dir: 'routes', mode: 'file-based', extensions: ['.svelte'] },
  // Astro
  { dir: 'src/pages', mode: 'file-based', extensions: ['.astro', '.md', '.mdx'] },
  // SolidStart, Qwik, Gridsome, Saber all use pages/ or src/pages
  // Hugo: content/
  { dir: 'content', mode: 'content', extensions: ['.md', '.html'] },
  // Jekyll: _posts/, _pages/
  {
    dir: '_posts',
    mode: 'content',
    extensions: ['.md', '.markdown', '.html'],
  },
  { dir: '_pages', mode: 'content', extensions: ['.md', '.html'] },
  // Eleventy: src/, content/, posts/
  { dir: 'src', mode: 'content', extensions: ['.njk', '.liquid', '.md'] },
  // Middleman: source/
  { dir: 'source', mode: 'content', extensions: ['.html', '.erb', '.md'] },
]

async function detectRoutes(rootDir: string): Promise<MappedRoute[]> {
  const out = new Map<string, MappedRoute>()
  for (const cfg of ROUTE_DIRS) {
    const dir = path.join(rootDir, cfg.dir)
    if (!(await exists(dir))) continue
    await scanRoutes(dir, dir, '', out, cfg)
  }
  return Array.from(out.values())
}

async function scanRoutes(
  baseDir: string,
  dir: string,
  prefix: string,
  out: Map<string, MappedRoute>,
  cfg: (typeof ROUTE_DIRS)[number],
): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      // Nuxt/SvelteKit/Next-style group dirs `(name)` are transparent.
      const seg = e.name.startsWith('(') && e.name.endsWith(')') ? '' : e.name
      const childPrefix = seg ? `${prefix}/${seg}` : prefix
      await scanRoutes(baseDir, full, childPrefix, out, cfg)
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase()
      if (!cfg.extensions.includes(ext)) continue
      let routePath = computeRoutePath(prefix, e.name, ext, cfg.mode)
      if (routePath === null) continue
      // Normalize: collapse slashes, convert [slug] → :slug everywhere
      // (covers SvelteKit dirs that wrap a +page.svelte file).
      routePath = routePath
        .replace(/\/+/g, '/')
        .replace(/\[\.\.\.([^\]]+)\]/g, '*$1')
        .replace(/\[([^\]]+)\]/g, ':$1')
      if (!routePath) routePath = '/'
      if (out.has(routePath)) continue
      const absPath = path.join(dir, e.name)
      const relPath = path.relative(baseDir, absPath).replace(/\\/g, '/')
      const extraction = await extractTemplateRouteMetadata(absPath, relPath, routePath)
      out.set(routePath, {
        path: routePath,
        parentPath: parentOf(routePath),
        entryPoints: [],
        extraction,
      })
    }
  }
}

async function extractTemplateRouteMetadata(
  absPath: string,
  relPath: string,
  routePath: string,
): Promise<MappedRoute['extraction']> {
  const extraction: NonNullable<MappedRoute['extraction']> = { sourceFile: relPath }
  const params = (routePath.match(/:[a-zA-Z_]\w*/g) ?? []).map((s) => s.slice(1))
  if (params.length > 0) extraction.params = params
  let source = ''
  try {
    source = await fs.readFile(absPath, 'utf-8')
  } catch {
    return extraction
  }
  // <title> in <head> / <svelte:head>
  const titleMatch = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch) {
    const t = titleMatch[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (t) extraction.title = t.slice(0, 200)
  }
  // First <h1>
  if (!extraction.title) {
    const h1 = source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    if (h1) {
      const t = h1[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (t) extraction.title = t.slice(0, 200)
    }
  }
  // Section headings
  const sections: string[] = []
  const headingRe = /<h(?:2|3)[^>]*>([\s\S]*?)<\/h(?:2|3)>/gi
  let h: RegExpExecArray | null
  while ((h = headingRe.exec(source)) !== null) {
    const text = h[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (text && sections.length < 12) sections.push(text.slice(0, 120))
  }
  if (sections.length > 0) extraction.sections = sections
  // Frontmatter / meta description
  const desc = source.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
  if (desc) extraction.description = desc[1]
  // Auth heuristic
  if (
    /\bsession\.user|getServerSession|supabase\.auth|firebase\.auth|requireAuth/i.test(source)
  ) {
    extraction.authRequired = true
  }
  return extraction
}

function computeRoutePath(
  prefix: string,
  fileName: string,
  ext: string,
  mode: 'file-based' | 'content',
): string | null {
  const base = fileName.slice(0, -ext.length)

  if (mode === 'file-based') {
    // SvelteKit: +page.svelte / +layout.svelte / +server.ts - only +page is routable.
    if (base.startsWith('+')) {
      if (base !== '+page') return null
      return prefix || '/'
    }
    // Nuxt/Astro/Vue: index.<ext> → dir, [slug] → :slug, etc.
    let segment = base
    if (segment === 'index') return prefix || '/'
    if (segment.startsWith('_')) return null // Astro layout / partial
    if (segment.startsWith('[') && segment.endsWith(']')) {
      segment = ':' + segment.slice(1, -1).replace('...', '*')
    }
    return prefix + '/' + segment
  }

  // 'content' mode (SSGs): file path becomes the route directly.
  if (base === 'index') return prefix || '/'
  return prefix + '/' + base
}

function parentOf(p: string): string | null {
  if (p === '/' || !p.includes('/')) return null
  const parts = p.split('/').filter(Boolean)
  parts.pop()
  return parts.length === 0 ? '/' : '/' + parts.join('/')
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function collectTemplateFiles(
  rootDir: string,
): Promise<Array<{ absPath: string; relPath: string }>> {
  const out: Array<{ absPath: string; relPath: string }> = []
  const state = { seen: 0 }
  await walk(rootDir, rootDir, out, 0, state)
  return out
}

async function walk(
  rootDir: string,
  dir: string,
  out: Array<{ absPath: string; relPath: string }>,
  depth: number,
  state: { seen: number },
): Promise<void> {
  if (depth > 10 || state.seen > MAX_FILES) return
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (state.seen > MAX_FILES) return
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      if (e.name.startsWith('.') && depth === 0) continue
      await walk(rootDir, full, out, depth + 1, state)
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase()
      if (!TEMPLATE_EXTS.has(ext)) continue
      state.seen++
      out.push({
        absPath: full,
        relPath: path.relative(rootDir, full).replace(/\\/g, '/'),
      })
    }
  }
}

// ── Tag-by-tag extraction ───────────────────────────────────────────────────

interface TagMatch {
  tag: string
  fullMatch: string
  attrs: Record<string, string>
  /** Inner text after the opening tag, up to the closing tag if found. */
  innerText: string
  index: number
}

const VOID_TAGS = new Set(['input', 'br', 'hr', 'img'])

function* findTags(source: string, tags: string[]): Generator<TagMatch> {
  // Build a single regex that captures the relevant tags + their attributes.
  // Non-greedy match for the inner content; we handle close-tag separately.
  const pattern = new RegExp(`<(${tags.join('|')})\\b([^>]*)>`, 'gi')
  let m: RegExpExecArray | null
  while ((m = pattern.exec(source)) !== null) {
    const tag = m[1]!.toLowerCase()
    const rawAttrs = m[2] ?? ''
    const attrs = parseAttrs(rawAttrs)
    let innerText = ''
    if (!VOID_TAGS.has(tag) && !rawAttrs.endsWith('/')) {
      const close = source.indexOf(`</${tag}`, m.index + m[0].length)
      if (close >= 0) {
        innerText = source.slice(m.index + m[0].length, close)
      }
    }
    yield {
      tag,
      fullMatch: m[0],
      attrs,
      innerText,
      index: m.index,
    }
  }
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  // name="value" | name='value' | name=value | name (boolean)
  const re = /([:@a-zA-Z_][\w:.\-@]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    const name = m[1]!
    const value = m[2] ?? m[3] ?? m[4] ?? ''
    out[name] = value
  }
  return out
}

const ELEMENT_TYPE_MAP: Record<string, ElementType> = {
  button: 'BUTTON',
  input: 'INPUT',
  textarea: 'INPUT',
  select: 'SELECT',
  form: 'FORM',
  a: 'LINK',
}

const HANDLER_ATTRS = [
  'onclick',
  'onsubmit',
  'onchange',
  'oninput',
  '@click',
  '@submit',
  '@change',
  '@input',
  'v-on:click',
  'v-on:submit',
  'on:click',
  'on:submit',
  'x-on:click',
  '(click)',
  '(submit)',
]

function extractFromTemplate(filePath: string, source: string): CollectedElement[] {
  const out: CollectedElement[] = []
  const counts: Record<string, number> = {}

  // Track the most recent enclosing form (best-effort linear scan).
  const formStack: Array<{ id?: string; name?: string; action?: string; closeAt: number }> = []

  const tagsToFind = ['button', 'input', 'textarea', 'select', 'form', 'a']
  for (const m of findTags(source, tagsToFind)) {
    // Pop closed forms.
    while (formStack.length > 0 && (formStack[formStack.length - 1]!.closeAt ?? 0) <= m.index) {
      formStack.pop()
    }
    if (m.tag === 'form') {
      const closeAt = source.indexOf('</form', m.index + m.fullMatch.length)
      formStack.push({
        id: m.attrs.id,
        name: m.attrs.name,
        action: m.attrs.action,
        closeAt: closeAt === -1 ? Infinity : closeAt,
      })
    }
    const elementType = ELEMENT_TYPE_MAP[m.tag] ?? null
    if (!elementType) continue

    counts[m.tag] = (counts[m.tag] ?? 0) + 1
    const idx = counts[m.tag]! - 1
    const descriptor = `${m.tag}[${idx}]`

    const labelRaw = pickLabel(m, source)
    const handler = pickHandler(m.attrs)
    const routeTarget = m.attrs['href'] ?? m.attrs['to'] ?? null

    const extraction: ElementExtraction = {}
    const validation = readValidationFromAttrs(m.attrs, m.tag)
    if (Object.keys(validation).length > 0) extraction.validation = validation
    if (m.attrs.placeholder) extraction.placeholder = m.attrs.placeholder
    if (m.attrs.title) extraction.helpText = m.attrs.title
    if (m.attrs['aria-describedby']) extraction.ariaDescription = m.attrs['aria-describedby']
    if (m.attrs.name) extraction.name = m.attrs.name
    if (m.attrs.value && (m.tag === 'input' || m.tag === 'textarea')) {
      extraction.defaultValue = m.attrs.value
    }
    const role = inferUniversalSemanticRole(m.tag, labelRaw, m.attrs)
    if (role) extraction.semanticRole = role
    if (role && (role === 'DANGER' || role === 'DELETE' || role === 'LOGOUT')) {
      extraction.destructive = true
    }
    extraction.positionInParent = idx
    if (m.tag === 'form') {
      extraction.endpoint = m.attrs.action ?? undefined
    }
    if (formStack.length > 0) {
      const top = formStack[formStack.length - 1]!
      extraction.formContext = top.id ?? top.name ?? '(unnamed-form)'
    }
    const tags = inferUniversalTags(m.tag, m.attrs, labelRaw)
    if (tags.length > 0) extraction.tags = tags

    out.push({
      filePath,
      descriptor,
      elementType,
      labelRaw,
      handlerFunction: handler,
      routeTarget,
      extraction,
    })
  }

  // Also scan for HTMX / Alpine.js attributes on arbitrary elements.
  const htmxRegex = /<([a-zA-Z][\w-]*)([^>]*?\b(?:hx-[a-z]+|x-on:[a-z]+|@[a-z]+|v-on:[a-z]+|on:[a-z]+|\(click\)|\(submit\))=[^>]*)>/gi
  let mm: RegExpExecArray | null
  let customCount = 0
  while ((mm = htmxRegex.exec(source)) !== null) {
    const tag = mm[1]!.toLowerCase()
    if (ELEMENT_TYPE_MAP[tag]) continue // already captured above
    const attrs = parseAttrs(mm[2] ?? '')
    const handler = pickHandler(attrs)
    const labelRaw = attrs['title'] ?? attrs['aria-label'] ?? null
    const extraction: ElementExtraction = {}
    if (attrs.title) extraction.helpText = attrs.title
    if (attrs['aria-describedby']) extraction.ariaDescription = attrs['aria-describedby']
    if (attrs.name) extraction.name = attrs.name
    const role = inferUniversalSemanticRole(tag, labelRaw, attrs)
    if (role) extraction.semanticRole = role
    if (attrs['hx-get'] || attrs['hx-post']) {
      extraction.endpoint = attrs['hx-get'] ?? attrs['hx-post']
      extraction.tags = ['htmx']
    }
    if (attrs['x-on:click'] || attrs['v-on:click'] || attrs['@click']) {
      extraction.tags = (extraction.tags ?? []).concat('alpine-or-vue')
    }
    customCount++
    out.push({
      filePath,
      descriptor: `${tag}[custom-${customCount - 1}]`,
      elementType: 'CUSTOM',
      labelRaw,
      handlerFunction: handler,
      routeTarget: attrs['href'] ?? attrs['hx-get'] ?? attrs['hx-post'] ?? null,
      extraction,
    })
  }

  return out
}

function readValidationFromAttrs(
  attrs: Record<string, string>,
  tag: string,
): ValidationRules {
  const v: ValidationRules = {}
  if ('required' in attrs) v.required = true
  if ('disabled' in attrs) v.disabled = true
  if ('readonly' in attrs || 'readOnly' in attrs) v.readonly = true
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

const UNIV_ROLE_KEYWORDS: Array<[SemanticRole, RegExp]> = [
  ['SUBMIT', /^(submit|save|create|continue|next|sign\s?up|register|apply|send|publish|post)\b/i],
  ['CANCEL', /^(cancel|close|discard|nevermind|back|skip)\b/i],
  ['DANGER', /^(delete|remove|destroy|drop|wipe|clear|deactivate)\b/i],
  ['DISMISS', /^(dismiss|close|×|✕|hide)\b/i],
  ['RETRY', /^(retry|try again|reload|refresh)\b/i],
  ['HELP', /^(help|support|contact|faq|docs|documentation)\b/i],
  ['CONFIRM', /^(confirm|yes|ok|agree|accept|approve)\b/i],
  ['SEARCH', /^(search|find|lookup)\b/i],
  ['FILTER', /^(filter|narrow|refine)\b/i],
  ['MENU', /^(menu|more|options|⋮|☰)\b/i],
  ['EDIT', /^(edit|rename|modify|change|update)\b/i],
  ['DELETE', /^(delete|remove|trash|archive)\b/i],
  ['LOGIN', /^(log\s?in|sign\s?in|authenticate)\b/i],
  ['LOGOUT', /^(log\s?out|sign\s?out)\b/i],
  ['PAYMENT', /^(pay|checkout|purchase|buy|complete\s+(order|purchase))\b/i],
]

function inferUniversalSemanticRole(
  tag: string,
  labelRaw: string | null,
  attrs: Record<string, string>,
): SemanticRole | null {
  if (tag === 'input' && attrs.type === 'submit') return 'SUBMIT'
  if (tag === 'button' && attrs.type === 'submit') return 'SUBMIT'
  if (attrs['data-role']) {
    const dr = attrs['data-role'].toUpperCase() as SemanticRole
    if (
      [
        'SUBMIT',
        'CANCEL',
        'DANGER',
        'PRIMARY',
        'SECONDARY',
        'DISMISS',
        'RETRY',
        'HELP',
        'CONFIRM',
        'SEARCH',
        'FILTER',
        'MENU',
        'EDIT',
        'DELETE',
        'LOGIN',
        'LOGOUT',
        'PAYMENT',
        'NAV',
        'TOGGLE',
        'EXPAND',
      ].includes(dr)
    ) {
      return dr
    }
  }
  if (tag === 'a' && (attrs.href === '#help' || attrs.href === '/help')) return 'HELP'
  if (tag === 'a' && (attrs.href === '#search' || attrs.href === '/search')) return 'SEARCH'
  if (tag === 'a') return 'NAV'
  if (labelRaw) {
    for (const [role, re] of UNIV_ROLE_KEYWORDS) {
      if (re.test(labelRaw.trim())) return role
    }
  }
  const cls = (attrs.class ?? attrs.className ?? '').toLowerCase()
  if (cls.includes('danger') || cls.includes('destructive')) return 'DANGER'
  if (cls.includes('primary') || cls.includes('cta')) return 'PRIMARY'
  return null
}

function inferUniversalTags(
  tag: string,
  attrs: Record<string, string>,
  labelRaw: string | null,
): string[] {
  const tags: string[] = []
  if (tag === 'button' && !labelRaw && (attrs['aria-label'] || /icon/i.test(attrs.class ?? ''))) {
    tags.push('icon-only')
  }
  if (attrs.disabled === 'true' || 'disabled' in attrs) tags.push('disabled')
  const cls = (attrs.class ?? attrs.className ?? '').toLowerCase()
  if (cls.includes('hidden') || attrs['aria-hidden'] === 'true') tags.push('hidden')
  return tags
}

function pickLabel(m: TagMatch, source: string): string | null {
  const aria = m.attrs['aria-label']
  if (aria) return aria
  const title = m.attrs['title']
  if (title) return title
  const placeholder = m.attrs['placeholder']
  if (placeholder) return placeholder
  const value = m.attrs['value']
  if (value && (m.tag === 'input' || m.tag === 'button')) return value
  if (m.innerText) {
    // Strip nested HTML tags + collapse whitespace.
    const text = m.innerText
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length > 0) return text.slice(0, 200)
  }
  // Pull text after the opening tag, up to 80 chars (for tags whose closing
  // didn't get matched, e.g. on truncated source).
  const after = source.slice(m.index + m.fullMatch.length, m.index + m.fullMatch.length + 200)
  const stripped = after.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return stripped.length > 0 ? stripped.slice(0, 80) : null
}

function pickHandler(attrs: Record<string, string>): string | null {
  for (const a of HANDLER_ATTRS) {
    if (attrs[a]) {
      const v = attrs[a]
      // Try to extract function name.
      const fnMatch = v.match(/([a-zA-Z_$][\w$]*)\s*\(/)
      if (fnMatch) return fnMatch[1]!
      return v.length > 30 ? '(inline)' : v
    }
  }
  return null
}
