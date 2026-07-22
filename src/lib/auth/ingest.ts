/**
 * Per-org ingest authentication.
 *
 * Customers paste a bearer token into their SDK init; the SDK sends it as
 * `Authorization: Bearer <token>` on /api/events. The server hashes the
 * presented token (SHA-256) and looks up an `IngestKey` row. Plaintext is
 * never persisted - only the hash + a short prefix for UI matching.
 *
 * Backwards compatibility: if `REQUIRE_INGEST_KEY` env is not set, the
 * server falls back to accepting `X-Org-Id` (open-access dev mode).
 */

import { prisma } from '@/lib/db'

const TOKEN_PREFIX = 'ck_'
const TOKEN_BYTES = 24 // ~32 chars base64-url after prefix
const PREFIX_LENGTH = 8

/**
 * Generate a fresh ingest key for an org. Returns the plaintext (shown ONCE)
 * and the persisted prefix. The plaintext is the only chance the customer
 * has to copy it; we store only the hash.
 */
export async function createIngestKey(
  orgId: string,
  label?: string,
): Promise<{ plaintext: string; prefix: string; id: string }> {
  const plaintext = TOKEN_PREFIX + randomToken(TOKEN_BYTES)
  const hash = await sha256Hex(plaintext)
  const prefix = plaintext.slice(0, PREFIX_LENGTH)

  const row = await prisma.ingestKey.create({
    data: { orgId, hash, prefix, label: label ?? null },
    select: { id: true },
  })
  return { plaintext, prefix, id: row.id }
}

/**
 * Resolve a presented bearer token to an orgId. Returns null on miss / revoke.
 * Updates `lastUsedAt` best-effort.
 */
export async function resolveIngestToken(token: string): Promise<{ orgId: string } | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null
  const hash = await sha256Hex(token)
  const row = await prisma.ingestKey.findUnique({
    where: { hash },
    select: { id: true, orgId: true, revokedAt: true },
  })
  if (!row || row.revokedAt) return null
  // Best-effort lastUsedAt update; don't block the request.
  prisma.ingestKey
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {})
  return { orgId: row.orgId }
}

export async function revokeIngestKey(id: string, orgId: string): Promise<void> {
  await prisma.ingestKey.updateMany({
    where: { id, orgId },
    data: { revokedAt: new Date() },
  })
}

export async function listIngestKeys(orgId: string) {
  return prisma.ingestKey.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      prefix: true,
      label: true,
      createdAt: true,
      revokedAt: true,
      lastUsedAt: true,
    },
  })
}

function randomToken(bytes: number): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return base64url(arr)
}

function base64url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  const b64 = typeof btoa !== 'undefined' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s)
  const buf = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(buf)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, '0')
  return hex
}

/**
 * REQUIRE_INGEST_KEY=true forces all /api/events POSTs to present a valid
 * bearer token. Default is unset - open-access for dev.
 */
export function ingestKeyRequired(): boolean {
  return process.env.REQUIRE_INGEST_KEY === 'true' || process.env.REQUIRE_INGEST_KEY === '1'
}
