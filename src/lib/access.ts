/**
 * Access layer - abstracts auth between two modes:
 *
 *   1. OPEN ACCESS (dev / unauthenticated)
 *      - No sign-in required.
 *      - All requests operate against a singleton "Demo" Org provisioned on
 *        first hit. The Org's data is shared across the entire deployment.
 *      - Gate: REQUIRE_AUTH != "true" AND we're not in production.
 *      - Why: trial / demo / hackday / no-Postgres-yet flows. Auth scaffolding
 *        is preserved for when REQUIRE_AUTH=true.
 *
 *   2. AUTH MODE (prod / multi-tenant)
 *      - Auth.js v5 magic link required.
 *      - First sign-in auto-provisions a per-user Org (see src/lib/auth.ts).
 *      - Gate: REQUIRE_AUTH=true OR NODE_ENV=production.
 *
 * Every page or API route that reads/writes customer data should call
 * `getCurrentOrg()` instead of `auth()` directly. That keeps the auth/no-auth
 * branch in exactly one place.
 */

import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

const DEMO_ORG_NAME = 'Demo Workspace'
const DEMO_USER_EMAIL = 'demo@clarus-heal.local'

export interface AccessContext {
  orgId: string
  /** Email of the signed-in user. Null in open-access mode. */
  userEmail: string | null
  mode: 'open' | 'auth'
}

export function isOpenAccessMode(): boolean {
  if (process.env.REQUIRE_AUTH === 'true') return false
  if (process.env.NODE_ENV === 'production' && process.env.REQUIRE_AUTH !== 'false') {
    // Default to auth-required in production unless explicitly opted out.
    return false
  }
  return true
}

/**
 * Get the org the current request operates against.
 * In auth mode, redirects to /sign-in if the caller isn't signed in (server
 * components only - API routes should use `getOrgForApi()` instead).
 */
export async function getCurrentOrg(redirectTo = '/'): Promise<AccessContext> {
  if (isOpenAccessMode()) {
    const org = await getOrCreateDemoOrg()
    return { orgId: org.id, userEmail: null, mode: 'open' }
  }
  const session = await auth()
  if (!session?.user || !session.orgId) {
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(redirectTo)}`)
  }
  return {
    orgId: session.orgId,
    userEmail: session.user.email ?? null,
    mode: 'auth',
  }
}

/**
 * For API routes that may not have a session (open-access fallback).
 * Returns null in auth-required mode if the caller isn't authenticated; the
 * caller is responsible for returning a 401.
 */
export async function getOrgForApi(): Promise<AccessContext | null> {
  if (isOpenAccessMode()) {
    const org = await getOrCreateDemoOrg()
    return { orgId: org.id, userEmail: null, mode: 'open' }
  }
  const session = await auth()
  if (!session?.user || !session.orgId) return null
  return {
    orgId: session.orgId,
    userEmail: session.user.email ?? null,
    mode: 'auth',
  }
}

/**
 * Lazily provisions the singleton demo org. Idempotent - safe to call from
 * many concurrent requests; the unique constraint on User.email + Org.name
 * keeps duplicates from sneaking in.
 */
async function getOrCreateDemoOrg() {
  const existing = await prisma.org.findFirst({
    where: { name: DEMO_ORG_NAME },
    select: { id: true },
  })
  if (existing) return existing

  // Create a placeholder user to own the demo org so referential integrity
  // is preserved even when no one has signed in.
  const user = await prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    create: {
      email: DEMO_USER_EMAIL,
      name: 'Demo',
    },
    update: {},
    select: { id: true },
  })

  const created = await prisma.org.create({
    data: {
      name: DEMO_ORG_NAME,
      ownerUserId: user.id,
      memberships: {
        create: { userId: user.id, role: 'OWNER' },
      },
    },
    select: { id: true },
  })
  return created
}
