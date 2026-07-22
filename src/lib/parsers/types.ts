/**
 * Parser layer - types and errors.
 *
 * The framework registry lives in `registry.ts`. The runtime detector lives
 * in `detector.ts`. Family-specific parsers live alongside this file.
 *
 * Adding a new framework is two steps:
 *   1. Append to FRAMEWORKS in registry.ts (metadata + detection rules)
 *   2. Plug a Parser into PARSERS in index.ts (or use BaseStubParser)
 */

import type { UIMap } from '@/lib/types/ui-map'

export type FrameworkFamily =
  | 'react'
  | 'preact'
  | 'vue'
  | 'svelte'
  | 'angular'
  | 'astro'
  | 'solid'
  | 'qwik'
  | 'lit'
  | 'stencil'
  | 'polymer'
  | 'ember'
  | 'dojo'
  | 'mithril'
  | 'marko'
  | 'aurelia'
  | 'alpine'
  | 'htmx'
  | 'fasthtml'
  | 'fresh'
  | 'ssg'
  | 'build-tool'
  | 'other'

export type ParserStatus =
  /** Real implementation; reliable extraction. */
  | 'stable'
  /** Real implementation; some edge cases. */
  | 'beta'
  /** Detection works; extraction is a stub returning an empty UIMap. */
  | 'planned'
  /** Detection works; partial extraction. */
  | 'experimental'

export interface DetectionRules {
  /** package.json dependencies (any of these found = match). */
  packageDeps?: string[]
  /** Glob-ish file patterns at repo root (any match = match). */
  configFiles?: string[]
  /** File extensions anywhere in src/ (any match = match). */
  fileExtensions?: string[]
  /** Strings to look for in package.json scripts. */
  scriptIncludes?: string[]
}

export interface FrameworkMetadata {
  id: string
  name: string
  family: FrameworkFamily
  description: string
  homepage?: string
  detection: DetectionRules
  parserStatus: ParserStatus
  /** Higher = checked first (more specific frameworks win over their bases). */
  detectionPriority?: number
}

export interface DetectionEvidence {
  kind: 'package-dep' | 'config-file' | 'file-extension' | 'script'
  value: string
}

export interface DetectionMatch {
  framework: FrameworkMetadata
  confidence: number
  evidence: DetectionEvidence[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser interface (re-exported convenience)
// ─────────────────────────────────────────────────────────────────────────────

export type { Parser, ParseInput, ParseSource } from '@/lib/types/ui-map'

export interface ParseContext {
  framework: FrameworkMetadata
  /** orgId is also on the ParseInput; this is here for parsers that need it without re-threading. */
  orgId: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class NotYetImplementedError extends Error {
  constructor(public readonly frameworkId: string) {
    super(
      `The parser for framework "${frameworkId}" is detection-only right now. ` +
        `Element extraction is planned. See src/lib/parsers/registry.ts for status.`,
    )
    this.name = 'NotYetImplementedError'
  }
}

export class ParserError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'ParserError'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stub UIMap helper for planned parsers
// ─────────────────────────────────────────────────────────────────────────────

export function emptyUIMap(orgId: string): UIMap {
  return {
    schemaVersion: 1,
    orgId,
    elements: [],
    routes: [],
  }
}
