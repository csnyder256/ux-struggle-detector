import { createServer, type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Nodemailer from 'next-auth/providers/nodemailer'
import { MAX_EMAIL_LENGTH, normalizeSignInEmail } from '@/lib/auth/email'

interface Delivery {
  from: string
  to: string[]
  data: string
}

/**
 * The smallest SMTP server nodemailer will deliver to: plaintext, no AUTH,
 * one message at a time. It records the envelope and the raw message.
 */
function smtpSink(deliveries: Delivery[]) {
  return createServer((socket) => {
    let buffer = ''
    let inData = false
    let current: Delivery = { from: '', to: [], data: '' }
    socket.setEncoding('utf8')
    socket.write('220 sink ESMTP\r\n')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n')
          if (end === -1) return
          current.data = buffer.slice(0, end)
          buffer = buffer.slice(end + 5)
          deliveries.push(current)
          current = { from: '', to: [], data: '' }
          inData = false
          socket.write('250 queued\r\n')
          continue
        }
        const eol = buffer.indexOf('\r\n')
        if (eol === -1) return
        const line = buffer.slice(0, eol)
        buffer = buffer.slice(eol + 2)
        const verb = line.slice(0, 4).toUpperCase()
        if (verb === 'MAIL') current.from = line
        if (verb === 'RCPT') current.to.push(line)
        if (verb === 'DATA') {
          inData = true
          socket.write('354 end with <CRLF>.<CRLF>\r\n')
        } else if (verb === 'QUIT') {
          socket.end('221 bye\r\n')
          return
        } else {
          socket.write('250 ok\r\n')
        }
      }
    })
  })
}

function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

describe('magic-link email', () => {
  const deliveries: Delivery[] = []
  const sink = smtpSink(deliveries)
  let port = 0

  beforeAll(async () => {
    await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', resolve))
    port = (sink.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => sink.close(() => resolve()))
  })

  // The Auth.js provider is the only nodemailer caller, and next-auth's peer
  // range lags nodemailer's majors, so this is the check that a nodemailer
  // upgrade still delivers sign-in mail.
  it('is delivered over SMTP by the installed nodemailer', async () => {
    const server = { host: '127.0.0.1', port, secure: false }
    const from = 'Clarus Heal <login@example.test>'
    const provider = Nodemailer({ server, from, normalizeIdentifier: normalizeSignInEmail })
    const url =
      'http://localhost:3000/api/auth/callback/nodemailer?callbackUrl=%2Fdashboard&token=abc123&email=user%40example.test'

    await provider.sendVerificationRequest({
      identifier: normalizeSignInEmail('  User@Example.TEST '),
      url,
      expires: new Date(Date.now() + 60_000),
      provider: { ...provider, server, from },
      token: 'abc123',
      theme: { colorScheme: 'auto', brandColor: '#346df1', buttonText: '#fff' },
      request: new Request('http://localhost:3000/api/auth/signin/nodemailer'),
    })

    expect(deliveries).toHaveLength(1)
    const mail = deliveries[0]!
    expect(mail.from).toMatch(/^MAIL FROM:<login@example\.test>/)
    expect(mail.to).toEqual(['RCPT TO:<user@example.test>'])
    const message = decodeQuotedPrintable(mail.data)
    expect(message).toContain('Subject: Sign in to localhost:3000')
    expect(message).toContain(url)
  })
})

describe('normalizeSignInEmail', () => {
  it('applies the Auth.js default rules', () => {
    expect(normalizeSignInEmail('  Alice@Example.COM ')).toBe('alice@example.com')
    expect(normalizeSignInEmail('alice@example.com,evil.test')).toBe('alice@example.com')
    // NFKC folds full-width letters to ASCII
    expect(normalizeSignInEmail('\uff41lice@example.com')).toBe('alice@example.com')
  })

  it('rejects what Auth.js rejects', () => {
    const invalid = [
      '',
      'alice',
      'alice@',
      '@example.com',
      'a@b@example.com',
      '"alice@evil.test"@example.com',
      // a full-width @ becomes a second real @ under NFKC
      'alice\uff20evil.test@example.com',
    ]
    for (const address of invalid) {
      expect(() => normalizeSignInEmail(address), address).toThrow()
    }
  })

  it('rejects addresses longer than RFC 5321 allows', () => {
    const longest = 'a'.repeat(64) + '@' + 'b'.repeat(MAX_EMAIL_LENGTH - 70) + '.test'
    expect(longest).toHaveLength(MAX_EMAIL_LENGTH)
    expect(normalizeSignInEmail(longest)).toBe(longest)
    expect(() => normalizeSignInEmail('a' + longest)).toThrow()
    // The shape that made nodemailer's address parser slow
    expect(() => normalizeSignInEmail('a,'.repeat(500_000) + 'x@example.test')).toThrow()
  })
})
