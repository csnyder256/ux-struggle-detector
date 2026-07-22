/**
 * Framework auto-detector.
 *
 * Given a directory of repo files (already cloned or fetched), returns the
 * frameworks that match. A repo can match more than one - e.g. a Next.js
 * project that also uses TanStack Router for nested layouts.
 *
 * Detection signal sources:
 *   1. package.json dependencies + devDependencies
 *   2. Top-level config file presence
 *   3. File extensions seen anywhere under src/
 *   4. package.json scripts (informational, lower confidence)
 *
 * Confidence is computed from how many independent signals matched. The
 * detector is deliberately conservative - false positives on the framework
 * level cascade into wrong parsing, so we'd rather under-report.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { FRAMEWORKS } from './registry'
import type { DetectionEvidence, DetectionMatch } from './types'

export interface DetectionInput {
  /** Absolute path to the repo root (must contain package.json or other config). */
  rootDir: string
  /** Optional: override file system access for testing. */
  readFile?: (relativePath: string) => Promise<string | null>
  listExtensions?: () => Promise<Set<string>>
}

export async function detectFrameworks(input: DetectionInput): Promise<DetectionMatch[]> {
  const readFile =
    input.readFile ??
    (async (rel: string) => {
      try {
        return await fs.readFile(path.join(input.rootDir, rel), 'utf-8')
      } catch {
        return null
      }
    })

  const listExtensions = input.listExtensions ?? (() => listExtensionsFs(input.rootDir))

  // Read package.json once.
  let pkg: PackageJson | null = null
  const pkgRaw = await readFile('package.json')
  if (pkgRaw) {
    try {
      pkg = JSON.parse(pkgRaw) as PackageJson
    } catch {
      pkg = null
    }
  }

  const allDeps: Set<string> = new Set([
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {}),
    ...Object.keys(pkg?.peerDependencies ?? {}),
  ])

  const allScripts = Object.values(pkg?.scripts ?? {}).join(' ')
  const extensions = await listExtensions()

  const matches: DetectionMatch[] = []

  for (const fw of FRAMEWORKS) {
    const evidence: DetectionEvidence[] = []

    // 1. package.json deps
    for (const dep of fw.detection.packageDeps ?? []) {
      if (allDeps.has(dep)) evidence.push({ kind: 'package-dep', value: dep })
    }

    // 2. config files
    for (const cfg of fw.detection.configFiles ?? []) {
      const content = await readFile(cfg)
      if (content !== null) evidence.push({ kind: 'config-file', value: cfg })
    }

    // 3. file extensions
    for (const ext of fw.detection.fileExtensions ?? []) {
      if (extensions.has(ext)) evidence.push({ kind: 'file-extension', value: ext })
    }

    // 4. scripts (low signal)
    for (const s of fw.detection.scriptIncludes ?? []) {
      if (allScripts.includes(s)) evidence.push({ kind: 'script', value: s })
    }

    if (evidence.length === 0) continue

    matches.push({
      framework: fw,
      confidence: confidenceFromEvidence(evidence),
      evidence,
    })
  }

  // Sort: higher confidence first, then by detectionPriority.
  matches.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence
    return (b.framework.detectionPriority ?? 0) - (a.framework.detectionPriority ?? 0)
  })

  return matches
}

/**
 * Resolve to a single primary framework. Used when we need a one-answer
 * decision (e.g., for routing a parser dispatch). Falls back to the
 * highest-priority match when multiple frameworks tied for confidence.
 */
export function pickPrimary(matches: DetectionMatch[]): DetectionMatch | null {
  if (matches.length === 0) return null
  // The list is already sorted by detectFrameworks().
  // Prefer non-build-tool families - Vite/Parcel/Brunch tell us "JS app" but not which framework.
  const concrete = matches.find((m) => m.framework.family !== 'build-tool')
  return concrete ?? matches[0]!
}

function confidenceFromEvidence(evidence: DetectionEvidence[]): number {
  // Each kind is worth a different base score; multiple kinds compound.
  const weights: Record<DetectionEvidence['kind'], number> = {
    'package-dep': 0.55,
    'config-file': 0.4,
    'file-extension': 0.25,
    script: 0.1,
  }
  // Combine via 1 - product(1 - w), capped at 0.99.
  const product = evidence.reduce((acc, e) => acc * (1 - weights[e.kind]), 1)
  return Math.min(0.99, 1 - product)
}

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

// ── File-system extension scan ──────────────────────────────────────────────

async function listExtensionsFs(rootDir: string): Promise<Set<string>> {
  const out = new Set<string>()
  await walk(rootDir, rootDir, out, 0, { seen: 0 })
  return out
}

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
  '.parcel-cache',
  '.turbo',
])

const MAX_DEPTH = 6
const MAX_FILES = 5000

async function walk(
  rootDir: string,
  dir: string,
  out: Set<string>,
  depth: number,
  state: { seen: number },
): Promise<void> {
  if (depth > MAX_DEPTH || state.seen > MAX_FILES) return
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (state.seen > MAX_FILES) return
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      await walk(rootDir, path.join(dir, e.name), out, depth + 1, state)
    } else if (e.isFile()) {
      state.seen++
      const ext = path.extname(e.name)
      if (ext) out.add(ext)
    }
  }
}
