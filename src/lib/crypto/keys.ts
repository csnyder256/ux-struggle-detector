/**
 * AES-256-GCM encryption for at-rest API key storage.
 *
 * Master key lives in env (`KEY_ENCRYPTION_KEY`, 32 bytes base64).
 * Each record gets a fresh 12-byte IV; the GCM auth tag is appended to the
 * ciphertext. The DB stores `(ciphertext, iv)` as separate columns.
 *
 * Plaintext keys ARE NEVER persisted, ARE NEVER logged, and ARE NEVER
 * re-rendered to the client after submission. The dashboard masks via
 * `lastFour` only.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32

export interface EncryptedKey {
  /** base64(ciphertext || authTag) */
  ciphertext: string
  /** base64(iv) */
  iv: string
}

function getMasterKey(): Buffer {
  const raw = process.env.KEY_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'KEY_ENCRYPTION_KEY is not set. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    )
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== KEY_LEN) {
    throw new Error(`KEY_ENCRYPTION_KEY must decode to ${KEY_LEN} bytes; got ${buf.length}.`)
  }
  return buf
}

export function encryptApiKey(plaintext: string): EncryptedKey {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, getMasterKey(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: Buffer.concat([ct, tag]).toString('base64'),
    iv: iv.toString('base64'),
  }
}

export function decryptApiKey(enc: EncryptedKey): string {
  const data = Buffer.from(enc.ciphertext, 'base64')
  const iv = Buffer.from(enc.iv, 'base64')
  if (data.length <= TAG_LEN) {
    throw new Error('Ciphertext shorter than auth tag length.')
  }
  const tag = data.subarray(data.length - TAG_LEN)
  const ct = data.subarray(0, data.length - TAG_LEN)
  const decipher = createDecipheriv(ALGO, getMasterKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/** Last 4 chars of the plaintext, for UI masking ("sk-...XYZ4"). */
export function lastFour(plaintext: string): string {
  return plaintext.length <= 4 ? '*'.repeat(plaintext.length) : plaintext.slice(-4)
}

/** Render a masked display string given just the lastFour stored in DB. */
export function maskedDisplay(lastFourValue: string): string {
  return `••••••••${lastFourValue}`
}
