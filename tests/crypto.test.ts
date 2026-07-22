import { describe, it, expect, beforeAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encryptApiKey, decryptApiKey, lastFour, maskedDisplay } from '@/lib/crypto/keys'

beforeAll(() => {
  process.env.KEY_ENCRYPTION_KEY = randomBytes(32).toString('base64')
})

describe('encrypt/decrypt round-trip', () => {
  it('round-trips a typical API key', () => {
    const plaintext = 'sk-ant-api03-this-is-a-fake-key-for-tests-1234567890ABCDEF'
    const enc = encryptApiKey(plaintext)
    expect(enc.ciphertext).not.toContain(plaintext)
    expect(enc.iv).not.toEqual(enc.ciphertext)
    const decoded = decryptApiKey(enc)
    expect(decoded).toBe(plaintext)
  })

  it('produces different ciphertext on each encryption (per-call IV)', () => {
    const plaintext = 'secret-token'
    const a = encryptApiKey(plaintext)
    const b = encryptApiKey(plaintext)
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.iv).not.toBe(b.iv)
    expect(decryptApiKey(a)).toBe(plaintext)
    expect(decryptApiKey(b)).toBe(plaintext)
  })

  it('rejects tampered ciphertext (auth tag fails)', () => {
    const enc = encryptApiKey('secret')
    // Flip a byte in the ciphertext
    const buf = Buffer.from(enc.ciphertext, 'base64')
    buf.writeUInt8(buf.readUInt8(0) ^ 0xff, 0)
    const tampered = { ciphertext: buf.toString('base64'), iv: enc.iv }
    expect(() => decryptApiKey(tampered)).toThrow()
  })
})

describe('masking', () => {
  it('lastFour returns last 4 chars', () => {
    expect(lastFour('sk-ant-api03-XYZ4')).toBe('XYZ4')
  })

  it('lastFour pads short strings with asterisks', () => {
    expect(lastFour('abc')).toBe('***')
  })

  it('maskedDisplay prepends bullets', () => {
    expect(maskedDisplay('XYZ4')).toBe('••••••••XYZ4')
  })
})
