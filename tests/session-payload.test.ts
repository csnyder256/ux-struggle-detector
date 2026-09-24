import { beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const SESSION_TOKEN = 'secret-session-token'
const expires = new Date(Date.now() + 24 * 60 * 60 * 1000)
const user = {
  id: 'user_1',
  name: null,
  email: 'owner@example.test',
  emailVerified: new Date(),
  image: null,
}

// The database, reduced to one stored session and its owner's membership.
vi.mock('@auth/prisma-adapter', () => ({
  PrismaAdapter: () => ({
    getSessionAndUser: async (sessionToken: string) =>
      sessionToken === SESSION_TOKEN
        ? { session: { id: 'session_1', sessionToken, userId: user.id, expires }, user }
        : null,
    updateSession: async () => null,
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    createUser: vi.fn(),
    getUser: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserByAccount: vi.fn(),
    updateUser: vi.fn(),
    linkAccount: vi.fn(),
    createVerificationToken: vi.fn(),
    useVerificationToken: vi.fn(),
  }),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    membership: { findFirst: async () => ({ orgId: 'org_1', role: 'OWNER' }) },
  },
}))

beforeAll(() => {
  process.env.AUTH_SECRET = 'test-only-secret-0123456789abcdef0123456789'
})

describe('/api/auth/session', () => {
  it('serves the org context and never the session token', async () => {
    const { handlers } = await import('@/lib/auth')
    const res = await handlers.GET(
      new NextRequest('http://localhost:3000/api/auth/session', {
        headers: { cookie: `authjs.session-token=${SESSION_TOKEN}` },
      }),
    )
    const body = await res.json()

    expect(body).toMatchObject({
      orgId: 'org_1',
      role: 'OWNER',
      user: { id: 'user_1', email: 'owner@example.test' },
    })
    expect(Object.keys(body).sort()).toEqual(['expires', 'orgId', 'role', 'user'])
    expect(JSON.stringify(body)).not.toContain(SESSION_TOKEN)
  })
})
