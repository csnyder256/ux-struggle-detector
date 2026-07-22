/**
 * GitHub repo mapper. Given an installation + repo, walks the repo's tree via
 * the Octokit API, fetches every parseable file, writes them to a temp dir,
 * and runs the standard `mapAndPersist()` over the result.
 *
 * Strategy: tree + blob (no tarball download, no `tar` shell-out). Slower per
 * call than a tarball + extract, but pure Node - works on every platform with
 * no extra deps.
 *
 * Cap: only files matching parseable extensions are downloaded so we don't
 * blow up on a 5000-file monorepo with a tiny `package.json` change.
 */

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getInstallationOctokit } from './app'
import { mapAndPersist, type MapAndPersistResult } from '@/lib/parsers/persist'
import { prisma } from '@/lib/db'

const PARSEABLE_EXT = new Set([
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.astro',
  '.marko',
  '.html',
  '.htm',
  '.liquid',
  '.erb',
  '.njk',
  '.hbs',
  '.mustache',
  '.pug',
  '.ejs',
  '.twig',
  '.md',
  '.mdx',
])
const FW_FILES = new Set([
  'package.json',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'svelte.config.js',
  'nuxt.config.js',
  'nuxt.config.ts',
  'astro.config.js',
  'astro.config.mjs',
  'astro.config.ts',
  'angular.json',
  'remix.config.js',
  'gatsby-config.js',
  'docusaurus.config.js',
  'docusaurus.config.ts',
])
const MAX_FILES = 1500

export interface GhMapResult extends MapAndPersistResult {
  filesFetched: number
}

export async function mapGithubRepo(opts: {
  orgId: string
  installationId: number
  fullName: string
  defaultBranch: string | null
}): Promise<GhMapResult> {
  const [owner, repo] = opts.fullName.split('/')
  if (!owner || !repo) {
    return {
      ok: false,
      error: `Invalid full name "${opts.fullName}"`,
      filesFetched: 0,
    }
  }

  const octokit = getInstallationOctokit(opts.installationId)
  const branch = opts.defaultBranch ?? 'main'

  // 1. Resolve branch sha → tree
  let treeSha: string
  try {
    const { data: ref } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    })
    treeSha = ref.object.sha
  } catch (err) {
    return {
      ok: false,
      error: `Could not resolve branch "${branch}": ${(err as Error).message}`,
      filesFetched: 0,
    }
  }

  // 2. Recursive tree
  let entries: Array<{ path: string; sha: string; size: number; type: string }> = []
  try {
    const { data: tree } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: treeSha,
      recursive: 'true',
    })
    if (!tree.tree) {
      return { ok: false, error: 'Empty tree response.', filesFetched: 0 }
    }
    entries = tree.tree
      .filter((t): t is typeof tree.tree[number] & { path: string; sha: string; type: 'blob' } =>
        t.type === 'blob' && typeof t.path === 'string' && typeof t.sha === 'string',
      )
      .map((t) => ({ path: t.path, sha: t.sha, size: t.size ?? 0, type: t.type }))
  } catch (err) {
    return {
      ok: false,
      error: `Tree fetch failed: ${(err as Error).message}`,
      filesFetched: 0,
    }
  }

  // 3. Filter to parseable files + framework configs
  const wanted = entries
    .filter((e) => {
      const base = path.posix.basename(e.path)
      const ext = path.posix.extname(e.path).toLowerCase()
      if (FW_FILES.has(base)) return true
      if (!PARSEABLE_EXT.has(ext)) return false
      // Skip vendored / build outputs
      if (
        e.path.startsWith('node_modules/') ||
        e.path.startsWith('.next/') ||
        e.path.startsWith('dist/') ||
        e.path.startsWith('build/') ||
        e.path.startsWith('out/') ||
        e.path.startsWith('.svelte-kit/')
      )
        return false
      // Skip declaration / test files
      if (e.path.endsWith('.d.ts') || /\.(test|spec)\.[tj]sx?$/.test(e.path)) return false
      return true
    })
    .slice(0, MAX_FILES)

  if (wanted.length === 0) {
    return { ok: false, error: 'No parseable files found in repo.', filesFetched: 0 }
  }

  // 4. Materialize to temp dir
  const workDir = await fs.mkdtemp(path.join(tmpdir(), `clarus-gh-${opts.installationId}-`))
  let fetched = 0
  try {
    for (const entry of wanted) {
      try {
        const { data: blob } = await octokit.git.getBlob({
          owner,
          repo,
          file_sha: entry.sha,
        })
        const buf = Buffer.from(blob.content, blob.encoding as BufferEncoding)
        const dest = path.join(workDir, entry.path)
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.writeFile(dest, buf)
        fetched++
      } catch {
        // skip individual file failures
      }
    }

    // 5. Run the standard parser pipeline
    const mapResult = await mapAndPersist(opts.orgId, workDir)

    // 6. Update the GitHubRepo row's status
    try {
      await prisma.gitHubRepo.updateMany({
        where: { orgId: opts.orgId, fullName: opts.fullName },
        data: {
          lastMappedAt: new Date(),
          mappingStatus: mapResult.ok ? 'SUCCEEDED' : 'FAILED',
          mappingError: mapResult.ok ? null : mapResult.error ?? null,
        },
      })
    } catch {
      // ignore
    }

    return { ...mapResult, filesFetched: fetched }
  } finally {
    // Best-effort cleanup
    try {
      await fs.rm(workDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}
