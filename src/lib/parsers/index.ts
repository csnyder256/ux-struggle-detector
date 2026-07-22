/**
 * Parser dispatcher. Maps a detected framework to its Parser implementation.
 *
 * Coverage strategy:
 *   - REACT family (JSX/TSX): ReactBabelParser - real AST extraction.
 *   - All other families: UniversalHtmlParser - regex-based template scan.
 *
 * That gives every framework in the registry a working parser. The
 * universal parser is less accurate than a real AST parser but produces
 * UIElements and labels for the dashboard, which is what "functional"
 * means at this layer. Real per-family parsers will replace it where the
 * accuracy gap matters.
 */

import { ReactBabelParser } from './react'
import { UniversalHtmlParser } from './universal-html'
import { detectFrameworks, pickPrimary } from './detector'
import type { Parser } from '@/lib/types/ui-map'
import type { FrameworkMetadata } from './types'

const parserCache: Record<string, Parser> = {}

export function getParserForFramework(framework: FrameworkMetadata): Parser {
  if (parserCache[framework.id]) return parserCache[framework.id]!

  let parser: Parser
  switch (framework.family) {
    case 'react':
    case 'preact':
      parser = new ReactBabelParser()
      break
    default:
      // Vue, Svelte, Angular, Astro, Solid, Qwik, Lit, Stencil, Polymer,
      // Ember, Dojo, Mithril, Marko, Aurelia, Alpine, HTMX, FastHTML, Fresh,
      // SSGs, build tools - all routed to the universal parser. That gives
      // every framework a functional extraction path on day 1.
      parser = new UniversalHtmlParser(framework.id)
      break
  }

  parserCache[framework.id] = parser
  return parser
}

export interface MapRepositoryOptions {
  orgId: string
  rootDir: string
  framework?: FrameworkMetadata
}

export interface MapRepositoryResult {
  framework: FrameworkMetadata | null
  detections: Awaited<ReturnType<typeof detectFrameworks>>
  uiMap: import('@/lib/types/ui-map').UIMap | null
  error?: string
}

export async function mapRepository(opts: MapRepositoryOptions): Promise<MapRepositoryResult> {
  const detections = await detectFrameworks({ rootDir: opts.rootDir })
  const primary = opts.framework
    ? { framework: opts.framework, confidence: 1, evidence: [] as never[] }
    : pickPrimary(detections)

  if (!primary) {
    return {
      framework: null,
      detections,
      uiMap: null,
      error: 'No supported frontend framework detected.',
    }
  }

  const parser = getParserForFramework(primary.framework)
  try {
    const uiMap = await parser.parse({
      orgId: opts.orgId,
      source: { kind: 'repo', rootDir: opts.rootDir },
    })
    return { framework: primary.framework, detections, uiMap }
  } catch (err) {
    return {
      framework: primary.framework,
      detections,
      uiMap: null,
      error: (err as Error).message,
    }
  }
}

export { detectFrameworks, pickPrimary } from './detector'
export {
  FRAMEWORKS,
  FRAMEWORK_COUNT,
  frameworksByFamily,
  getFramework,
} from './registry'
export type {
  FrameworkMetadata,
  DetectionMatch,
  FrameworkFamily,
  ParserStatus,
} from './types'
