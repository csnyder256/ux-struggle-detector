/**
 * React / JSX parser. Real Babel-based AST extraction for the React family
 * (Next.js, Remix, CRA, Gatsby, TanStack, React Router, Hydrogen, Ionic React,
 * Docusaurus, raw React + Vite). Per the plan it's the reference Parser
 * implementation; other families plug in alongside it.
 *
 * Extraction logic:
 *   - Parse each .tsx/.ts/.jsx/.js file with @babel/parser (jsx + typescript)
 *   - Walk every JSXElement, build a stable AST path descriptor
 *   - Identify element type (button/input/form/link/select/custom)
 *   - Capture handler function names (onClick / onChange / onSubmit / etc.)
 *   - Capture user-facing labels (text children, aria-label, title)
 *   - Hash via the canonical hashElementId() for ID stability across mapper /
 *     plugin / runtime SDK
 *
 * Routing extraction is separate and walks Next.js / Remix / TanStack route
 * conventions on disk. It does NOT depend on the AST parse - it just enumerates
 * file paths under app/, pages/, or routes/.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parse as babelParse } from '@babel/parser'
import babelTraverseModule from '@babel/traverse'
import * as t from '@babel/types'
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

// CommonJS-default fallback for @babel/traverse
const traverse =
  typeof babelTraverseModule === 'function'
    ? babelTraverseModule
    : (babelTraverseModule as { default: typeof babelTraverseModule }).default

const PARSEABLE_EXTS = new Set(['.tsx', '.ts', '.jsx', '.js', '.mjs'])
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.git',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage',
  'public',
  '.turbo',
])
const MAX_FILES = 2000

interface CollectedElement {
  filePath: string
  componentName: string | null
  descriptor: string
  elementType: ElementType
  labelRaw: string | null
  handlerFunction: string | null
  routeTarget: string | null
  extraction: ElementExtraction
}

export class ReactBabelParser implements Parser {
  readonly id = 'react'

  async parse(input: ParseInput): Promise<UIMap> {
    if (input.source.kind !== 'repo') {
      throw new Error('ReactBabelParser currently only supports source.kind === "repo".')
    }
    const rootDir = input.source.rootDir
    const orgId = input.orgId

    const files = await collectSourceFiles(rootDir)
    const collected: CollectedElement[] = []
    for (const f of files) {
      try {
        const contents = await fs.readFile(f.absPath, 'utf-8')
        collected.push(...extractFromFile(f.relPath, contents))
      } catch {
        // Skip unparseable files; the goal is best-effort coverage.
      }
    }

    // Hash element IDs in batch (async). After all IDs are computed we can
    // resolve sibling-id references in extraction to actual ElementIds.
    const ids = await Promise.all(
      collected.map((c) =>
        hashElementId({ orgId, filePath: c.filePath, nodeDescriptor: c.descriptor }),
      ),
    )
    const elements: MappedElement[] = []
    for (let i = 0; i < collected.length; i++) {
      const c = collected[i]!
      const id = ids[i]!
      const labelHash = c.labelRaw ? await hashLabel(c.labelRaw) : ''
      elements.push({
        id,
        filePath: c.filePath,
        componentName: c.componentName,
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

// ── File collection ──────────────────────────────────────────────────────────

async function collectSourceFiles(
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
      const ext = path.extname(e.name)
      if (!PARSEABLE_EXTS.has(ext)) continue
      // Skip declaration files and tests.
      if (e.name.endsWith('.d.ts')) continue
      if (/\.(test|spec)\.(t|j)sx?$/.test(e.name)) continue
      state.seen++
      out.push({
        absPath: full,
        relPath: path.relative(rootDir, full).replace(/\\/g, '/'),
      })
    }
  }
}

// ── AST extraction ───────────────────────────────────────────────────────────

const ELEMENT_TYPE_MAP: Record<string, ElementType> = {
  button: 'BUTTON',
  input: 'INPUT',
  select: 'SELECT',
  textarea: 'INPUT',
  form: 'FORM',
  a: 'LINK',
}

const INTERACTIVE_PROPS = new Set([
  'onClick',
  'onChange',
  'onSubmit',
  'onInput',
  'onKeyDown',
  'onKeyPress',
  'onKeyUp',
  'onFocus',
  'onBlur',
  'onMouseDown',
  'onMouseUp',
])

function extractFromFile(relPath: string, source: string): CollectedElement[] {
  let ast: t.File
  try {
    ast = babelParse(source, {
      sourceType: 'unambiguous',
      allowImportExportEverywhere: true,
      allowAwaitOutsideFunction: true,
      errorRecovery: true,
      plugins: ['jsx', 'typescript', 'decorators-legacy'],
    })
  } catch {
    return []
  }

  const out: CollectedElement[] = []

  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement
      const tagName = getTagName(opening.name)
      if (!tagName) return

      const isCustomComponent = /^[A-Z]/.test(tagName)
      const elementType = mapElementType(tagName, isCustomComponent, opening)
      if (elementType === null) return

      const descriptor = computeDescriptor(path)
      const componentName = findEnclosingComponentName(path)
      const handlerFn = findHandlerFunctionName(opening)
      const labelRaw = findLabel(path.node, opening)
      const routeTarget = findRouteTarget(opening)

      const attrs = readAttrs(opening)
      const extraction: ElementExtraction = {}

      // --- Validation rules
      const validation = readValidation(attrs, tagName)
      if (Object.keys(validation).length > 0) extraction.validation = validation

      // --- Common attributes
      if (attrs.placeholder) extraction.placeholder = attrs.placeholder
      if (attrs['default-value'] || attrs.defaultValue) {
        extraction.defaultValue = attrs.defaultValue ?? attrs['default-value']
      } else if (attrs.value && (tagName === 'input' || tagName === 'textarea')) {
        extraction.defaultValue = attrs.value
      }
      if (attrs.title) extraction.helpText = attrs.title
      if (attrs['aria-describedby']) extraction.ariaDescription = attrs['aria-describedby']
      if (attrs.name) extraction.name = attrs.name

      // --- Semantic role + tags
      const semanticRole = inferSemanticRole(tagName, labelRaw, attrs)
      if (semanticRole) extraction.semanticRole = semanticRole
      if (semanticRole && DESTRUCTIVE_ROLES.has(semanticRole)) extraction.destructive = true

      const tags = inferTags(opening, tagName, attrs, labelRaw)
      if (tags.length > 0) extraction.tags = tags

      // --- Form context
      const formCtx = findEnclosingFormContext(path)
      if (formCtx) extraction.formContext = formCtx

      // --- Position
      extraction.positionInParent = positionInParent(path)

      // --- Endpoint (form action / Link href)
      if (tagName === 'form' && attrs.action) extraction.endpoint = attrs.action

      out.push({
        filePath: relPath,
        componentName,
        descriptor,
        elementType,
        labelRaw,
        handlerFunction: handlerFn,
        routeTarget,
        extraction,
      })
    },
  })

  return out
}

function readAttrs(opening: t.JSXOpeningElement): Record<string, string> {
  const out: Record<string, string> = {}
  for (const attr of opening.attributes) {
    if (!t.isJSXAttribute(attr)) continue
    const name = t.isJSXIdentifier(attr.name)
      ? attr.name.name
      : t.isJSXNamespacedName(attr.name)
        ? `${attr.name.namespace.name}:${attr.name.name.name}`
        : null
    if (!name) continue
    const value = attr.value
    if (!value) {
      // Boolean attribute
      out[name] = 'true'
      continue
    }
    if (t.isStringLiteral(value)) {
      out[name] = value.value
    } else if (t.isJSXExpressionContainer(value)) {
      const expr = value.expression
      if (t.isStringLiteral(expr)) out[name] = expr.value
      else if (t.isNumericLiteral(expr)) out[name] = String(expr.value)
      else if (t.isBooleanLiteral(expr)) out[name] = String(expr.value)
      else if (t.isTemplateLiteral(expr) && expr.quasis.length === 1)
        out[name] = expr.quasis[0]!.value.cooked ?? ''
      // Otherwise skip - dynamic values not statically resolvable.
    }
  }
  return out
}

function readValidation(attrs: Record<string, string>, tagName: string): ValidationRules {
  const v: ValidationRules = {}
  if (attrs.required === 'true' || attrs.required === '') v.required = true
  if (attrs.disabled === 'true') v.disabled = true
  if (attrs.readonly === 'true' || attrs.readOnly === 'true') v.readonly = true
  if (attrs.minLength) {
    const n = Number(attrs.minLength)
    if (!Number.isNaN(n)) v.minLength = n
  }
  if (attrs.maxLength) {
    const n = Number(attrs.maxLength)
    if (!Number.isNaN(n)) v.maxLength = n
  }
  if (attrs.min) v.min = Number.isNaN(Number(attrs.min)) ? attrs.min : Number(attrs.min)
  if (attrs.max) v.max = Number.isNaN(Number(attrs.max)) ? attrs.max : Number(attrs.max)
  if (attrs.pattern) v.pattern = attrs.pattern
  if (attrs.step) v.step = Number.isNaN(Number(attrs.step)) ? attrs.step : Number(attrs.step)
  if (tagName === 'input' && attrs.type) v.inputType = attrs.type
  return v
}

const ROLE_KEYWORDS: Array<[SemanticRole, RegExp]> = [
  ['SUBMIT', /^(submit|save|create|continue|next|sign\s?up|register|apply|send|publish|post)\b/i],
  ['CANCEL', /^(cancel|close|discard|nevermind|back|skip)\b/i],
  ['DANGER', /^(delete|remove|destroy|drop|wipe|clear|cancel\s+account|deactivate)\b/i],
  ['DISMISS', /^(dismiss|close|×|✕|x|hide)\b/i],
  ['RETRY', /^(retry|try again|reload|refresh)\b/i],
  ['HELP', /^(help|support|contact|faq|docs|documentation)\b/i],
  ['CONFIRM', /^(confirm|yes|ok|agree|accept|approve)\b/i],
  ['SEARCH', /^(search|find|lookup)\b/i],
  ['FILTER', /^(filter|narrow|refine)\b/i],
  ['MENU', /^(menu|more|options|⋮|☰)\b/i],
  ['TOGGLE', /^(toggle|enable|disable|on|off|switch)\b/i],
  ['EXPAND', /^(expand|collapse|show more|see more|read more)\b/i],
  ['EDIT', /^(edit|rename|modify|change|update)\b/i],
  ['DELETE', /^(delete|remove|trash|archive)\b/i],
  ['LOGIN', /^(log\s?in|sign\s?in|authenticate)\b/i],
  ['LOGOUT', /^(log\s?out|sign\s?out)\b/i],
  ['PAYMENT', /^(pay|checkout|purchase|buy|complete\s+(order|purchase))\b/i],
  ['NAV', /^(home|dashboard|profile|settings|account)\b/i],
]

const DESTRUCTIVE_ROLES = new Set<SemanticRole>(['DANGER', 'DELETE', 'LOGOUT'])

function inferSemanticRole(
  tagName: string,
  labelRaw: string | null,
  attrs: Record<string, string>,
): SemanticRole | null {
  // Explicit type=submit / role attribute beats label.
  if (tagName === 'input' && attrs.type === 'submit') return 'SUBMIT'
  if (tagName === 'button' && attrs.type === 'submit') return 'SUBMIT'
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
        'TOGGLE',
        'EDIT',
        'DELETE',
        'LOGIN',
        'LOGOUT',
        'PAYMENT',
        'NAV',
        'EXPAND',
      ].includes(dr)
    ) {
      return dr
    }
  }
  if (tagName === 'a' && (attrs.href === '#help' || attrs.href === '/help')) return 'HELP'
  if (tagName === 'a' && (attrs.href === '#search' || attrs.href === '/search')) return 'SEARCH'
  if (tagName === 'a') return 'NAV'
  if (tagName === 'form' || tagName === 'select') return null

  if (labelRaw) {
    for (const [role, re] of ROLE_KEYWORDS) {
      if (re.test(labelRaw.trim())) return role
    }
  }
  // className / variant inference
  const cls = (attrs.className ?? attrs.class ?? '').toLowerCase()
  if (cls.includes('danger') || cls.includes('destructive')) return 'DANGER'
  if (cls.includes('primary') || cls.includes('cta')) return 'PRIMARY'
  if (cls.includes('secondary') || cls.includes('ghost')) return 'SECONDARY'
  return null
}

function inferTags(
  _opening: t.JSXOpeningElement,
  tagName: string,
  attrs: Record<string, string>,
  labelRaw: string | null,
): string[] {
  const tags: string[] = []
  // Icon-only buttons (no label, has aria-label or icon class)
  if (tagName === 'button' && !labelRaw && (attrs['aria-label'] || /icon/i.test(attrs.className ?? ''))) {
    tags.push('icon-only')
  }
  if (attrs.disabled === 'true') tags.push('disabled')
  if (/^(primary|cta|main)$/i.test(attrs.variant ?? '')) tags.push('primary-cta')
  const cls = (attrs.className ?? attrs.class ?? '').toLowerCase()
  if (cls.includes('hidden') || attrs['aria-hidden'] === 'true') tags.push('hidden')
  if (cls.includes('skeleton') || cls.includes('placeholder')) tags.push('placeholder')
  return tags
}

function findEnclosingFormContext(
  path: import('@babel/traverse').NodePath,
): string | null {
  let cur: import('@babel/traverse').NodePath | null = path.parentPath
  while (cur) {
    if (t.isJSXElement(cur.node)) {
      const tag = getTagName(cur.node.openingElement.name)
      if (tag === 'form') {
        const formAttrs = readAttrs(cur.node.openingElement)
        return formAttrs.id ?? formAttrs.name ?? '(unnamed-form)'
      }
    }
    cur = cur.parentPath
  }
  return null
}

function positionInParent(
  path: import('@babel/traverse').NodePath<t.JSXElement>,
): number {
  const parent = path.parent
  if (!parent || (!t.isJSXElement(parent) && !t.isJSXFragment(parent))) return 0
  const children = (parent as t.JSXElement | t.JSXFragment).children
  let idx = 0
  for (const child of children) {
    if (child === path.node) return idx
    if (t.isJSXElement(child)) idx++
  }
  return idx
}

function getTagName(name: t.JSXOpeningElement['name']): string | null {
  if (t.isJSXIdentifier(name)) return name.name
  if (t.isJSXMemberExpression(name)) {
    // e.g., <Components.Button>
    const parts: string[] = []
    let cur: t.JSXMemberExpression | t.JSXIdentifier = name
    while (t.isJSXMemberExpression(cur)) {
      parts.unshift((cur.property as t.JSXIdentifier).name)
      cur = cur.object as t.JSXMemberExpression | t.JSXIdentifier
    }
    if (t.isJSXIdentifier(cur)) parts.unshift(cur.name)
    return parts.join('.')
  }
  return null
}

function mapElementType(
  tag: string,
  isCustom: boolean,
  opening: t.JSXOpeningElement,
): ElementType | null {
  const lower = tag.toLowerCase()
  if (ELEMENT_TYPE_MAP[lower]) return ELEMENT_TYPE_MAP[lower]
  if (isCustom) {
    // Capture custom components only when they have an interactive-shaped prop.
    for (const attr of opening.attributes) {
      if (!t.isJSXAttribute(attr)) continue
      const attrName = t.isJSXIdentifier(attr.name) ? attr.name.name : null
      if (attrName && INTERACTIVE_PROPS.has(attrName)) return 'CUSTOM'
    }
  }
  return null
}

function computeDescriptor(path: import('@babel/traverse').NodePath<t.JSXElement>): string {
  const parts: string[] = []
  let cur: import('@babel/traverse').NodePath | null = path
  while (cur && t.isJSXElement(cur.node)) {
    const tag = getTagName((cur.node as t.JSXElement).openingElement.name)
    if (!tag) break
    const siblingIdx = computeSiblingIndex(cur as import('@babel/traverse').NodePath<t.JSXElement>, tag)
    parts.unshift(`${tag}[${siblingIdx}]`)
    cur = cur.parentPath
    // Stop when we hit a non-JSXElement / non-JSXFragment ancestor.
    while (cur && !t.isJSXElement(cur.node) && !t.isJSXFragment(cur.node)) {
      // Allow JSXFragment as a transparent wrapper.
      if (t.isJSXFragment(cur.node)) {
        cur = cur.parentPath
        continue
      }
      // Stop the upward walk; descriptor is local to the JSX tree.
      cur = null
      break
    }
  }
  return parts.join('>')
}

function computeSiblingIndex(
  path: import('@babel/traverse').NodePath<t.JSXElement>,
  tag: string,
): number {
  const parent = path.parent
  if (!parent || (!t.isJSXElement(parent) && !t.isJSXFragment(parent))) return 0
  const children = (parent as t.JSXElement | t.JSXFragment).children
  let idx = 0
  for (const child of children) {
    if (child === path.node) return idx
    if (t.isJSXElement(child)) {
      const childTag = getTagName(child.openingElement.name)
      if (childTag === tag) idx++
    }
  }
  return idx
}

function findEnclosingComponentName(
  path: import('@babel/traverse').NodePath,
): string | null {
  let cur: import('@babel/traverse').NodePath | null = path
  while (cur) {
    const node = cur.node
    if (t.isFunctionDeclaration(node) && node.id) return node.id.name
    if (t.isVariableDeclarator(node) && t.isIdentifier(node.id)) {
      const id = node.id.name
      if (/^[A-Z]/.test(id)) return id
    }
    if (t.isClassDeclaration(node) && node.id) return node.id.name
    cur = cur.parentPath
  }
  return null
}

function findHandlerFunctionName(opening: t.JSXOpeningElement): string | null {
  for (const attr of opening.attributes) {
    if (!t.isJSXAttribute(attr)) continue
    const name = t.isJSXIdentifier(attr.name) ? attr.name.name : null
    if (!name || !INTERACTIVE_PROPS.has(name)) continue
    const value = attr.value
    if (!value || !t.isJSXExpressionContainer(value)) continue
    const expr = value.expression
    if (t.isIdentifier(expr)) return expr.name
    if (t.isMemberExpression(expr) && t.isIdentifier(expr.property)) return expr.property.name
    if (t.isArrowFunctionExpression(expr) || t.isFunctionExpression(expr)) {
      return '(inline)'
    }
  }
  return null
}

function findLabel(
  el: t.JSXElement,
  opening: t.JSXOpeningElement,
): string | null {
  // 1. aria-label / title attributes
  for (const attr of opening.attributes) {
    if (!t.isJSXAttribute(attr)) continue
    const name = t.isJSXIdentifier(attr.name) ? attr.name.name : null
    if (name === 'aria-label' || name === 'title') {
      const v = attr.value
      if (v && t.isStringLiteral(v)) return v.value
    }
  }
  // 2. value / placeholder for input-like elements
  for (const attr of opening.attributes) {
    if (!t.isJSXAttribute(attr)) continue
    const name = t.isJSXIdentifier(attr.name) ? attr.name.name : null
    if (name === 'placeholder' || name === 'value') {
      const v = attr.value
      if (v && t.isStringLiteral(v)) return v.value
    }
  }
  // 3. JSX children text
  const text = collectTextChildren(el).trim()
  return text.length > 0 ? text.slice(0, 200) : null
}

function collectTextChildren(el: t.JSXElement): string {
  let out = ''
  for (const child of el.children) {
    if (t.isJSXText(child)) out += child.value
    else if (t.isJSXExpressionContainer(child) && t.isStringLiteral(child.expression)) {
      out += child.expression.value
    }
  }
  return out
}

function findRouteTarget(opening: t.JSXOpeningElement): string | null {
  // <Link href="..."> / <a href="...">
  for (const attr of opening.attributes) {
    if (!t.isJSXAttribute(attr)) continue
    const name = t.isJSXIdentifier(attr.name) ? attr.name.name : null
    if (name !== 'href' && name !== 'to') continue
    const v = attr.value
    if (v && t.isStringLiteral(v)) return v.value
  }
  return null
}

// ── Routing ──────────────────────────────────────────────────────────────────

async function detectRoutes(rootDir: string): Promise<MappedRoute[]> {
  const out: MappedRoute[] = []
  // Try Next.js app/ directory first.
  const appRoutes = await scanNextAppRoutes(path.join(rootDir, 'app'))
  if (appRoutes.length > 0) return appRoutes
  const srcAppRoutes = await scanNextAppRoutes(path.join(rootDir, 'src', 'app'))
  if (srcAppRoutes.length > 0) return srcAppRoutes
  // Fall back to Next.js pages/ directory.
  const pageRoutes = await scanNextPagesRoutes(path.join(rootDir, 'pages'))
  if (pageRoutes.length > 0) return pageRoutes
  const srcPageRoutes = await scanNextPagesRoutes(path.join(rootDir, 'src', 'pages'))
  if (srcPageRoutes.length > 0) return srcPageRoutes
  // Remix routes/
  const remixRoutes = await scanRemixRoutes(path.join(rootDir, 'app', 'routes'))
  if (remixRoutes.length > 0) return remixRoutes
  return out
}

async function scanNextAppRoutes(appDir: string): Promise<MappedRoute[]> {
  if (!(await exists(appDir))) return []
  const out: MappedRoute[] = []
  await walkRoutes(appDir, appDir, '', out, 'next-app')
  return out
}

async function scanNextPagesRoutes(pagesDir: string): Promise<MappedRoute[]> {
  if (!(await exists(pagesDir))) return []
  const out: MappedRoute[] = []
  await walkRoutes(pagesDir, pagesDir, '', out, 'next-pages')
  return out
}

async function scanRemixRoutes(routesDir: string): Promise<MappedRoute[]> {
  if (!(await exists(routesDir))) return []
  const out: MappedRoute[] = []
  await walkRoutes(routesDir, routesDir, '', out, 'remix')
  return out
}

async function walkRoutes(
  rootDir: string,
  dir: string,
  prefix: string,
  out: MappedRoute[],
  mode: 'next-app' | 'next-pages' | 'remix',
): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue

    if (e.isDirectory()) {
      const segment = e.name
      // Next.js route groups: (auth) → strip
      if (mode === 'next-app' && segment.startsWith('(') && segment.endsWith(')')) {
        await walkRoutes(rootDir, path.join(dir, e.name), prefix, out, mode)
        continue
      }
      const childPrefix = prefix + '/' + segment
      await walkRoutes(rootDir, path.join(dir, e.name), childPrefix, out, mode)
    } else if (e.isFile()) {
      let routePath: string | null = null
      if (mode === 'next-app' && /^page\.(t|j)sx?$/.test(e.name)) {
        routePath = prefix || '/'
      } else if (mode === 'next-pages' && /\.(t|j)sx?$/.test(e.name) && e.name !== '_app.tsx' && e.name !== '_document.tsx' && !e.name.startsWith('_')) {
        const base = e.name.replace(/\.(t|j)sx?$/, '')
        routePath = prefix + '/' + (base === 'index' ? '' : base)
        if (routePath === '/') routePath = '/'
      } else if (mode === 'remix' && /\.(t|j)sx?$/.test(e.name)) {
        // Remix flat-route convention: dots = nested, $ = dynamic
        const base = e.name.replace(/\.(t|j)sx?$/, '')
        const segs = base.split('.').map((s) => (s.startsWith('$') ? `:${s.slice(1) || 'param'}` : s))
        routePath = '/' + segs.filter((s) => s !== '_index' && s !== 'index').join('/')
        if (routePath === '/') routePath = '/'
      }

      if (routePath !== null) {
        const absPath = path.join(dir, e.name)
        const relPath = path.relative(rootDir, absPath).replace(/\\/g, '/')
        const norm = normalizeRoutePath(routePath)
        const extraction = await extractRouteMetadata(absPath, relPath, norm)
        out.push({
          path: norm,
          parentPath: null,
          entryPoints: [],
          extraction,
        })
      }
    }
  }
}

async function extractRouteMetadata(
  absPath: string,
  relPath: string,
  routePath: string,
): Promise<MappedRoute['extraction']> {
  const extraction: NonNullable<MappedRoute['extraction']> = { sourceFile: relPath }
  // Dynamic param names from the route path.
  const params = (routePath.match(/:[a-zA-Z_]\w*/g) ?? []).map((s) => s.slice(1))
  if (params.length > 0) extraction.params = params

  let source = ''
  try {
    source = await fs.readFile(absPath, 'utf-8')
  } catch {
    return extraction
  }

  // 1. Next.js metadata export
  const metaMatch = source.match(
    /export\s+const\s+metadata\s*[:=][^\{]*\{([\s\S]*?)\}\s*(?:as\s+const)?\s*(?:satisfies\s+\w+)?/,
  )
  if (metaMatch) {
    const block = metaMatch[1]!
    const titleMatch = block.match(/title\s*:\s*['"`]([^'"`]+)['"`]/)
    if (titleMatch) extraction.title = titleMatch[1]
    const descMatch = block.match(/description\s*:\s*['"`]([^'"`]+)['"`]/)
    if (descMatch) extraction.description = descMatch[1]
  }

  // 2. First <h1> in JSX
  if (!extraction.title) {
    const h1Match = source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    if (h1Match) {
      const text = h1Match[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (text.length > 0) extraction.title = text.slice(0, 200)
    }
  }

  // 3. Section headings (h2/h3)
  const sections: string[] = []
  const headingRe = /<h(?:2|3)[^>]*>([\s\S]*?)<\/h(?:2|3)>/gi
  let h: RegExpExecArray | null
  while ((h = headingRe.exec(source)) !== null) {
    const text = h[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (text && sections.length < 12) sections.push(text.slice(0, 120))
  }
  if (sections.length > 0) extraction.sections = sections

  // 4. Auth heuristic - lots of frameworks call auth() or check session
  if (
    /\bauth\s*\(\s*\)|getServerSession|currentUser|requireAuth|redirect.*sign-?in/i.test(source)
  ) {
    extraction.authRequired = true
  }

  return extraction
}

function normalizeRoutePath(p: string): string {
  if (p === '') return '/'
  // collapse double slashes
  return p.replace(/\/+/g, '/')
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
