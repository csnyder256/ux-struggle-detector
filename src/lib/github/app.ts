/**
 * GitHub App helpers.
 *
 * Reads the GitHub App credentials from env (see GITHUB_SETUP.md for how to
 * register the app and what to put in .env). Exposes:
 *   - getGitHubAppConfig() - null if anything is missing
 *   - getInstallationOctokit(installationId) - pre-authed Octokit for an installation
 *   - getInstallUrl() - where to redirect users to install the app
 *   - getAppOctokit() - Octokit authed as the app itself (for listing installations etc.)
 *
 * Every consumer should null-check getGitHubAppConfig() and surface a "GitHub
 * App not configured" UI instead of throwing.
 */

import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'

export interface GitHubAppConfig {
  appId: string
  appName: string
  clientId: string
  clientSecret: string
  /** Full PEM contents (decoded from the base64 env var). */
  privateKey: string
  webhookSecret: string
}

export function getGitHubAppConfig(): GitHubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID
  const appName = process.env.GITHUB_APP_NAME
  const clientId = process.env.GITHUB_APP_CLIENT_ID
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET
  const privateKeyEncoded = process.env.GITHUB_APP_PRIVATE_KEY
  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET

  if (
    !appId ||
    !appName ||
    !clientId ||
    !clientSecret ||
    !privateKeyEncoded ||
    !webhookSecret
  ) {
    return null
  }

  // The PEM is stored base64-encoded so it can live on a single env line.
  let privateKey: string
  try {
    privateKey = Buffer.from(privateKeyEncoded, 'base64').toString('utf-8')
    if (!privateKey.includes('BEGIN') || !privateKey.includes('PRIVATE KEY')) {
      // Not actually base64-encoded - assume the user pasted the PEM directly.
      privateKey = privateKeyEncoded
    }
  } catch {
    privateKey = privateKeyEncoded
  }

  return {
    appId,
    appName,
    clientId,
    clientSecret,
    privateKey,
    webhookSecret,
  }
}

export function isGitHubAppConfigured(): boolean {
  return getGitHubAppConfig() !== null
}

/** Octokit authenticated AS the app (JWT). Use to list installations etc. */
export function getAppOctokit(): Octokit {
  const cfg = getGitHubAppConfig()
  if (!cfg) throw new Error('GitHub App is not configured.')
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: cfg.appId,
      privateKey: cfg.privateKey,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
    },
  })
}

/** Octokit authenticated as a specific INSTALLATION (installation token). */
export function getInstallationOctokit(installationId: number): Octokit {
  const cfg = getGitHubAppConfig()
  if (!cfg) throw new Error('GitHub App is not configured.')
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: cfg.appId,
      privateKey: cfg.privateKey,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      installationId,
    },
  })
}

/** Where to redirect users to install the app. */
export function getInstallUrl(state?: string): string {
  const cfg = getGitHubAppConfig()
  if (!cfg) throw new Error('GitHub App is not configured.')
  const url = new URL(`https://github.com/apps/${cfg.appName}/installations/new`)
  if (state) url.searchParams.set('state', state)
  return url.toString()
}
