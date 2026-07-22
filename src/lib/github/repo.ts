/**
 * Repo content fetch + extract. Downloads a repo's tarball via the
 * authenticated installation and extracts it to a temp directory so the
 * static mapper can parse it.
 *
 * MVP scaffolding - not wired into the mapping worker yet. The worker
 * implementation lives in a later phase.
 */

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getInstallationOctokit } from './app'

export interface FetchedRepo {
  fullName: string
  defaultBranch: string
  /** Local extracted directory (caller owns cleanup). */
  rootDir: string
}

export interface FetchOptions {
  installationId: number
  owner: string
  repo: string
  /** Defaults to the repo's default branch. */
  ref?: string
}

/**
 * Download + extract a repo. Caller is responsible for cleaning up the
 * returned directory when done.
 *
 * Implementation note: Octokit's tarball endpoint redirects to S3-hosted
 * tarballs. We follow the redirect and stream-extract via node:zlib + tar.
 * For MVP scaffolding the body just downloads the buffer; tarball extraction
 * is left to the mapping worker (Phase 18).
 */
export async function fetchRepoMetadata(opts: FetchOptions) {
  const octokit = getInstallationOctokit(opts.installationId)
  const { data } = await octokit.repos.get({ owner: opts.owner, repo: opts.repo })
  return {
    fullName: data.full_name,
    defaultBranch: data.default_branch,
    private: data.private,
    description: data.description ?? null,
    language: data.language ?? null,
  }
}

/**
 * Read a single file from a repo without downloading the full tarball.
 * Useful for the auto-detector - `package.json` is enough for most framework
 * detection signals.
 */
export async function readRepoFile(
  opts: FetchOptions & { path: string },
): Promise<string | null> {
  const octokit = getInstallationOctokit(opts.installationId)
  try {
    const { data } = await octokit.repos.getContent({
      owner: opts.owner,
      repo: opts.repo,
      path: opts.path,
      ref: opts.ref,
    })
    if (Array.isArray(data) || data.type !== 'file') return null
    if (!('content' in data) || !data.content) return null
    return Buffer.from(data.content, 'base64').toString('utf-8')
  } catch {
    return null
  }
}

/**
 * Allocate a temp directory the worker can extract into. Caller must clean up.
 */
export async function makeWorkDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(tmpdir(), `clarus-${prefix}-`))
}
