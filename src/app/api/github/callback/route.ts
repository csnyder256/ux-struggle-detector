/**
 * GitHub App post-install callback.
 *
 * GitHub redirects the user here after they install (or update) the app.
 * Query params:
 *   - installation_id: the new installation ID (numeric)
 *   - setup_action: "install" | "update"
 *   - state: optional, set by us when initiating /api/github/install
 *
 * We persist the installation, list its repos, and redirect to the
 * onboarding "installed" page where the user picks which repo(s) to map.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { getOrgForApi } from '@/lib/access'
import { prisma } from '@/lib/db'
import { getGitHubAppConfig, getInstallationOctokit } from '@/lib/github/app'

export async function GET(request: NextRequest) {
  const ctx = await getOrgForApi()
  if (!ctx) {
    const url = new URL('/sign-in', request.url)
    url.searchParams.set('callbackUrl', '/onboarding/github')
    return NextResponse.redirect(url)
  }

  const cfg = getGitHubAppConfig()
  if (!cfg) {
    return NextResponse.redirect(
      new URL('/onboarding/github?error=not_configured', request.url),
    )
  }

  const installationIdStr = request.nextUrl.searchParams.get('installation_id')
  if (!installationIdStr) {
    return NextResponse.redirect(new URL('/onboarding/github?error=no_id', request.url))
  }
  const installationId = Number.parseInt(installationIdStr, 10)
  if (!Number.isFinite(installationId)) {
    return NextResponse.redirect(new URL('/onboarding/github?error=bad_id', request.url))
  }

  let octokit: ReturnType<typeof getInstallationOctokit>
  try {
    octokit = getInstallationOctokit(installationId)
  } catch {
    return NextResponse.redirect(
      new URL('/onboarding/github?error=auth_failed', request.url),
    )
  }

  // Fetch installation metadata (account login, type)
  let accountLogin = 'unknown'
  let accountType = 'User'
  let repositoriesUrl: string | null = null
  try {
    const { data: installation } = await octokit.apps.getInstallation({
      installation_id: installationId,
    })
    const account = installation.account
    if (account) {
      // GitHub's `account` is a union - User | Organization | Enterprise.
      // User/Organization have `login`; Enterprise has `slug`. Try both.
      if ('login' in account && typeof account.login === 'string') {
        accountLogin = account.login
      } else if ('slug' in account && typeof account.slug === 'string') {
        accountLogin = account.slug
      }
      if ('type' in account && typeof account.type === 'string') {
        accountType = account.type
      }
    }
    repositoriesUrl = installation.repositories_url ?? null
  } catch {
    // Soft-fail: proceed with placeholder values; user can rerun the flow.
  }

  const installRow = await prisma.gitHubInstallation.upsert({
    where: { installationId },
    create: {
      orgId: ctx.orgId,
      installationId,
      accountLogin,
      accountType,
      repositoriesUrl,
    },
    update: {
      accountLogin,
      accountType,
      repositoriesUrl,
      removedAt: null,
    },
  })

  // List repos accessible to this installation, and upsert them.
  try {
    const { data } = await octokit.apps.listReposAccessibleToInstallation({ per_page: 100 })
    for (const repo of data.repositories) {
      await prisma.gitHubRepo.upsert({
        where: {
          installationId_fullName: {
            installationId: installRow.id,
            fullName: repo.full_name,
          },
        },
        create: {
          orgId: ctx.orgId,
          installationId: installRow.id,
          fullName: repo.full_name,
          defaultBranch: repo.default_branch,
        },
        update: {
          defaultBranch: repo.default_branch,
        },
      })
    }
  } catch {
    // Repo listing is best-effort; the user can refresh from the onboarding page.
  }

  return NextResponse.redirect(new URL('/onboarding/github?status=installed', request.url))
}
