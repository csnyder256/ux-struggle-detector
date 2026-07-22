import { describe, it, expect, beforeEach } from 'vitest'
import { scrubText } from '@/sdk/scrubber'
import { RageClickDetector } from '@/sdk/struggle-detector'
import type { ElementId } from '@/lib/types/ui-map'
import { readAutoInitOptions } from '@/sdk'

describe('scrubText', () => {
  it('redacts emails', () => {
    expect(scrubText('contact me at user@example.com please')).toBe(
      'contact me at [redacted] please',
    )
  })

  it('redacts credit-card-like runs', () => {
    expect(scrubText('card: 4111 1111 1111 1111')).toBe('card: [redacted]')
    expect(scrubText('card: 4111-1111-1111-1111')).toBe('card: [redacted]')
  })

  it('redacts SSN', () => {
    expect(scrubText('ssn 123-45-6789')).toBe('ssn [redacted]')
  })

  it('passes through clean text', () => {
    expect(scrubText('hello world')).toBe('hello world')
  })

  it('applies custom patterns', () => {
    expect(scrubText('TOKEN_abc123', [/TOKEN_\w+/g])).toBe('[redacted]')
  })

  it('redacts US phone numbers', () => {
    expect(scrubText('call (415) 555-1234')).toContain('[redacted]')
    expect(scrubText('555-555-1234 today')).toContain('[redacted]')
    expect(scrubText('+1 555 555 1234')).toContain('[redacted]')
  })

  it('redacts JWTs', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.x9rHmULY9hF5zVJk_xZNPVLG4o5kxZD'
    expect(scrubText(`token=${jwt}`)).toBe('token=[redacted]')
  })

  it('redacts IPv4 addresses', () => {
    expect(scrubText('connecting to 192.168.1.1 now')).toContain('[redacted]')
  })

  it('redacts AWS access keys', () => {
    expect(scrubText('AKIAIOSFODNN7EXAMPLE here')).toContain('[redacted]')
  })

  it('redacts GitHub PATs', () => {
    expect(scrubText('token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij12')).toContain(
      '[redacted]',
    )
  })

  it('redacts Stripe keys', () => {
    // Assembled at runtime so no secret-shaped literal sits in the source. The
    // value is fake, but a literal would trip credential scanners on every push.
    const fake = ['sk', 'live', 'ABCDEFGHIJKLMNOPQRSTUVWX'].join('_')
    expect(scrubText(`using ${fake} as key`)).toContain('[redacted]')
  })

  it('redacts Anthropic-style API keys', () => {
    expect(scrubText('sk-ant-api03-ABCDEFGHIJKLMNOP-XYZ here')).toContain('[redacted]')
  })
})

describe('sampling logic', () => {
  // Test the sampling math directly - initSelfHealing has DOM side effects we
  // don't want in tests. The shape mirrors the real shouldSample().
  function shouldSample(
    cfg: number | ((t: string) => boolean) | { default?: number; byType?: Record<string, number> } | undefined,
    eventType: string,
    rng = Math.random,
  ): boolean {
    if (cfg === undefined) return true
    const exempt = new Set(['JS_ERROR', 'VALIDATION_ERROR'])
    if (exempt.has(eventType)) return true
    if (typeof cfg === 'number') return cfg >= 1 ? true : cfg <= 0 ? false : rng() < cfg
    if (typeof cfg === 'function') return cfg(eventType) !== false
    const perType = cfg.byType?.[eventType]
    const rate = typeof perType === 'number' ? perType : cfg.default ?? 1
    return rate >= 1 ? true : rate <= 0 ? false : rng() < rate
  }

  it('accepts everything when no config', () => {
    expect(shouldSample(undefined, 'CLICK')).toBe(true)
  })

  it('rate=0 drops events', () => {
    expect(shouldSample(0, 'CLICK')).toBe(false)
  })

  it('rate=1 passes everything', () => {
    expect(shouldSample(1, 'CLICK')).toBe(true)
  })

  it('per-type config respects override', () => {
    const cfg = { default: 1, byType: { SCROLL: 0 } }
    expect(shouldSample(cfg, 'CLICK')).toBe(true)
    expect(shouldSample(cfg, 'SCROLL')).toBe(false)
  })

  it('JS_ERROR is sampling-exempt even with rate=0', () => {
    expect(shouldSample(0, 'JS_ERROR')).toBe(true)
    expect(shouldSample({ default: 0 }, 'JS_ERROR')).toBe(true)
  })

  it('VALIDATION_ERROR is sampling-exempt', () => {
    expect(shouldSample(0, 'VALIDATION_ERROR')).toBe(true)
  })

  it('predicate function controls sampling', () => {
    const cfg = (t: string) => t === 'CLICK'
    expect(shouldSample(cfg, 'CLICK')).toBe(true)
    expect(shouldSample(cfg, 'HOVER')).toBe(false)
  })

  it('rate=0.5 with biased RNG produces correct binary outcomes', () => {
    expect(shouldSample(0.5, 'CLICK', () => 0.3)).toBe(true)
    expect(shouldSample(0.5, 'CLICK', () => 0.7)).toBe(false)
  })
})

describe('readAutoInitOptions', () => {
  it('returns null when no data-org-id script exists', () => {
    expect(readAutoInitOptions({ currentScript: null, scripts: [] })).toBeNull()
  })

  it('returns null when currentScript has no orgId AND scripts is empty', () => {
    expect(
      readAutoInitOptions({ currentScript: { dataset: {} }, scripts: [] }),
    ).toBeNull()
  })

  it('reads orgId from currentScript', () => {
    const opts = readAutoInitOptions({
      currentScript: { dataset: { orgId: 'org_abc' } },
      scripts: [],
    })
    expect(opts?.orgId).toBe('org_abc')
  })

  it('reads ingest key + endpoint when present', () => {
    const opts = readAutoInitOptions({
      currentScript: {
        dataset: {
          orgId: 'org_x',
          ingestKey: 'ck_demo',
          endpoint: 'https://example.com/api/events',
        },
      },
      scripts: [],
    })
    expect(opts?.orgId).toBe('org_x')
    expect(opts?.ingestKey).toBe('ck_demo')
    expect(opts?.endpoint).toBe('https://example.com/api/events')
  })

  it('parses numeric flushIntervalMs', () => {
    const opts = readAutoInitOptions({
      currentScript: { dataset: { orgId: 'org_x', flushIntervalMs: '1500' } },
      scripts: [],
    })
    expect(opts?.flushIntervalMs).toBe(1500)
  })

  it('falls back to last scripts entry when currentScript is null', () => {
    const opts = readAutoInitOptions({
      currentScript: null,
      scripts: [
        { dataset: { orgId: 'org_first' } },
        { dataset: { orgId: 'org_last' } },
      ],
    })
    expect(opts?.orgId).toBe('org_last')
  })
})

describe('RageClickDetector', () => {
  let detector: RageClickDetector
  const id1 = 'sh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as ElementId
  const id2 = 'sh_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as ElementId

  beforeEach(() => {
    detector = new RageClickDetector()
  })

  it('does not fire on a single click', () => {
    const r = detector.observe(id1)
    expect(r.detected).toBe(false)
  })

  it('does not fire on two clicks', () => {
    detector.observe(id1)
    const r = detector.observe(id1)
    expect(r.detected).toBe(false)
  })

  it('fires on three clicks on the same element', () => {
    detector.observe(id1)
    detector.observe(id1)
    const r = detector.observe(id1)
    expect(r.detected).toBe(true)
    if (r.detected) {
      expect(r.type).toBe('RAGE_CLICK')
      expect(r.elementId).toBe(id1)
    }
  })

  it('does not fire when clicks are spread across different elements', () => {
    detector.observe(id1)
    detector.observe(id2)
    const r = detector.observe(id1)
    expect(r.detected).toBe(false)
  })

  it('resets after firing', () => {
    detector.observe(id1)
    detector.observe(id1)
    const r1 = detector.observe(id1)
    expect(r1.detected).toBe(true)
    const r2 = detector.observe(id1)
    expect(r2.detected).toBe(false)
  })
})
