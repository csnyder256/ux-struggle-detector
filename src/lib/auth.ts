/**
 * Auth.js v5 (NextAuth) - magic-link sign-in via SMTP.
 *
 * On first sign-in we auto-provision an Org owned by the user and an
 * OWNER Membership so the rest of the app can rely on session.orgId.
 */

import NextAuth, { type DefaultSession } from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Nodemailer from 'next-auth/providers/nodemailer'
import { prisma } from '@/lib/db'
import { normalizeSignInEmail } from '@/lib/auth/email'

declare module 'next-auth' {
  interface Session {
    orgId?: string
    role?: 'OWNER' | 'ADMIN' | 'MEMBER'
    user: {
      id: string
    } & DefaultSession['user']
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  trustHost: true,
  providers: [
    Nodemailer({
      server: {
        host: process.env.EMAIL_SERVER_HOST,
        port: Number(process.env.EMAIL_SERVER_PORT ?? 587),
        auth: {
          user: process.env.EMAIL_SERVER_USER,
          pass: process.env.EMAIL_SERVER_PASSWORD,
        },
      },
      from: process.env.EMAIL_FROM,
      normalizeIdentifier: normalizeSignInEmail,
    }),
  ],
  pages: {
    signIn: '/sign-in',
    verifyRequest: '/sign-in/verify',
  },
  session: { strategy: 'database' },
  events: {
    async createUser({ user }) {
      // Auto-provision an Org + OWNER Membership on first sign-in.
      if (!user.id || !user.email) return
      const orgName = user.email.split('@')[0] ?? 'My Workspace'
      const org = await prisma.org.create({
        data: {
          name: orgName,
          ownerUserId: user.id,
          memberships: {
            create: {
              userId: user.id,
              role: 'OWNER',
            },
          },
        },
      })
      void org
    },
  },
  callbacks: {
    // With database sessions, Auth.js passes this callback the stored session
    // row (sessionToken included) and the full user row, and serves whatever
    // it returns as JSON from /api/auth/session. Returning `session` itself
    // handed the session token, the secret the HttpOnly cookie protects, to
    // any script on the page. Build the payload field by field instead.
    async session({ session, user }) {
      const membership = await prisma.membership.findFirst({
        where: { userId: user.id },
        select: { orgId: true, role: true },
        orderBy: { createdAt: 'asc' },
      })
      return {
        expires: session.expires,
        user: { id: user.id, name: user.name, email: user.email, image: user.image },
        orgId: membership?.orgId,
        role: membership?.role,
      }
    },
  },
})
