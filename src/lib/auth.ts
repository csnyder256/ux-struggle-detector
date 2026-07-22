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
    async session({ session, user }) {
      const membership = await prisma.membership.findFirst({
        where: { userId: user.id },
        select: { orgId: true, role: true },
        orderBy: { createdAt: 'asc' },
      })
      if (membership) {
        session.orgId = membership.orgId
        session.role = membership.role
      }
      session.user.id = user.id
      return session
    },
  },
})
