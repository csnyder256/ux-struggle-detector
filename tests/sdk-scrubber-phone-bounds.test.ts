import { describe, it, expect } from 'vitest'
import { scrubText } from '@/sdk/scrubber'

/**
 * The US-phone pattern's separators are all optional, so the pre-fix form
 * degraded to "any ten consecutive digits, anywhere" - it matched the tail of
 * any longer digit run, so the trailing ten digits of a 17-char tracking
 * number or a 20-char SKU were replaced with `[redacted]` and the field was
 * silently mangled. `length` on the INPUT_CHANGE event is computed from this
 * scrubbed value (src/sdk/index.ts:405-409), so the field-length signal that
 * SLOW_FILL and THRASH run on was corrupted too.
 *
 * The fix pins the match to a standalone run with `(?<![0-9A-Za-z])` and
 * `(?![0-9])`. Every real phone format still redacts; a ten-digit suffix of a
 * longer token no longer does.
 *
 * Scope note: a bare 13-digit epoch-millisecond timestamp is still redacted by
 * the separate 13-19 digit card pattern. That is a documented policy choice
 * ("13-19 digit credit-card-shaped runs") and is deliberately left unchanged
 * here; these tests assert the phone pattern's boundedness only.
 */
describe('US phone redaction is bounded to phone-shaped runs', () => {
  it('still redacts every supported phone format', () => {
    for (const phone of [
      'call (415) 555-1234',
      '555-555-1234 today',
      '+1 555 555 1234',
      '415.555.1234',
      '415 555 1234',
      'call 4155551234 now',
      '5551234567',
    ]) {
      expect(scrubText(phone)).toContain('[redacted]')
    }
  })

  it('does not eat the tail of a longer alphanumeric token', () => {
    const tracking = 'tracking 1Z999AA10123456784'
    expect(scrubText(tracking)).toBe(tracking)
    const sku = 'sku ABC1234567890123456'
    expect(scrubText(sku)).toBe(sku)
    // The pre-fix output was 'tracking 1Z999AA[redacted]' / 'sku ABC123456[redacted]'.
    expect(scrubText(tracking)).not.toContain('[redacted]')
    expect(scrubText(sku)).not.toContain('[redacted]')
  })

  it('preserves the full length of a token that merely contains ten digits', () => {
    const sku = 'ABC1234567890123456'
    expect(scrubText(sku).length).toBe(sku.length)
  })

  it('does not redact a 5-digit zip code', () => {
    expect(scrubText('zip 90210')).toBe('zip 90210')
  })
})
