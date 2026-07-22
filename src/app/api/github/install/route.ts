import { NextResponse, type NextRequest } from 'next/server'
import { getOrgForApi } from '@/lib/access'
import { getGitHubAppConfig, getInstallUrl } from '@/lib/github/app'

export async function GET(request: NextRequest) {
  const ctx = await getOrgForApi()
  if (!ctx) {
    const url = new URL('/sign-in', request.url)
    url.searchParams.set('callbackUrl', '/onboarding/github')
    return NextResponse.redirect(url)
  }

  const cfg = getGitHubAppConfig()
  if (!cfg) {
    const url = new URL('/onboarding/github', request.url)
    url.searchParams.set('error', 'not_configured')
    return NextResponse.redirect(url)
  }

  return NextResponse.redirect(getInstallUrl(ctx.orgId))
}
