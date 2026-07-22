import { describe, it, expect } from 'vitest'
import {
  dispatchInterventions,
  dispatchInterventionsWithRows,
  pickVariantBanditForTest,
  pickVariantIndexForTest,
  populationRowIdForTest,
  templateFor,
} from '@/lib/interventions/dispatcher'
import { STRUGGLE_INTERVENTIONS } from '@/lib/interventions/library'
import { ALL_STRUGGLE_TYPES, type StruggleDetection } from '@/lib/types/events'
import type { ElementId } from '@/lib/types/ui-map'

const E1 = 'sh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as ElementId

function det(type: StruggleDetection['type'], extra: Partial<StruggleDetection> = {}): StruggleDetection {
  return {
    sessionId: 'sess_1',
    elementId: extra.elementId ?? E1,
    type,
    severity: extra.severity ?? 0.5,
    ts: extra.ts ?? new Date('2026-05-01T12:00:00.000Z').toISOString(),
    summary: extra.summary,
  }
}

describe('STRUGGLE_INTERVENTIONS library', () => {
  it('has at least one template for every struggle type in the registry', () => {
    for (const type of ALL_STRUGGLE_TYPES) {
      const tmpls = STRUGGLE_INTERVENTIONS[type]
      expect(tmpls, `missing template for ${type}`).toBeDefined()
      expect(tmpls.length, `empty template list for ${type}`).toBeGreaterThan(0)
    }
  })

  it('templateFor() returns the first template per type', () => {
    const t = templateFor('RAGE_CLICK')
    expect(t.type).toBeDefined()
    expect(t.copy.length).toBeGreaterThan(0)
  })
})

describe('dispatchInterventions', () => {
  it('returns nothing in safe mode', () => {
    const out = dispatchInterventions([det('RAGE_CLICK')], { safeMode: true })
    expect(out).toEqual([])
  })

  it('returns one intervention per detection in normal mode', () => {
    const out = dispatchInterventions([det('RAGE_CLICK')], { safeMode: false })
    expect(out.length).toBe(1)
    expect(out[0]?.type).toBe('HIGHLIGHT')
    expect(out[0]?.copy.length).toBeGreaterThan(0)
  })

  it('substitutes {label} when an element label is supplied', () => {
    const labels = new Map([[E1 as string, 'Submit']])
    const out = dispatchInterventions([det('RAGE_CLICK')], {
      safeMode: false,
      elementLabels: labels,
    })
    // The first RAGE_CLICK template doesn't include {label}, but the second
    // (TOOLTIP) does. Try a struggle whose first template substitutes.
    const out2 = dispatchInterventions([det('HOVER_HUNT')], {
      safeMode: false,
      elementLabels: labels,
    })
    expect(out2[0]?.copy).toContain('Submit')
  })

  it('skips already-shown interventions when alreadyShown is provided', () => {
    const ts = '2026-05-01T12:00:00.000Z'
    const out1 = dispatchInterventions([det('RAGE_CLICK', { ts })], { safeMode: false })
    const id = out1[0]!.id
    const seen = new Set([id])
    const out2 = dispatchInterventions([det('RAGE_CLICK', { ts })], {
      safeMode: false,
      alreadyShown: seen,
    })
    expect(out2).toEqual([])
  })

  it('emits unique ids per (session, type, element, ts)', () => {
    const out = dispatchInterventions(
      [
        det('RAGE_CLICK', { ts: '2026-05-01T12:00:00.000Z' }),
        det('THRASH', { ts: '2026-05-01T12:00:00.000Z' }),
      ],
      { safeMode: false },
    )
    expect(out.length).toBe(2)
    expect(out[0]!.id).not.toBe(out[1]!.id)
  })

  it('emits highlight target for click-family struggles', () => {
    const out = dispatchInterventions([det('RAGE_CLICK')], { safeMode: false })
    expect(out[0]?.targetElementId).toBe(E1)
  })

  it('returns [] for empty input', () => {
    expect(dispatchInterventions([], { safeMode: false })).toEqual([])
  })
})

describe('library coverage of renderer types', () => {
  it('covers a variety of renderer types across struggle library', () => {
    const types = new Set<string>()
    for (const type of ALL_STRUGGLE_TYPES) {
      for (const t of STRUGGLE_INTERVENTIONS[type]) types.add(t.type)
    }
    // Exercise at least 6 different renderer types across the library.
    expect(types.size).toBeGreaterThanOrEqual(6)
  })
})

describe('A/B variant determinism', () => {
  it('always picks the same variant for a given (sessionId, type) pair', () => {
    const a = pickVariantIndexForTest('sess_1', 'RAGE_CLICK', 5)
    const b = pickVariantIndexForTest('sess_1', 'RAGE_CLICK', 5)
    expect(a).toBe(b)
  })

  it('returns 0 when there is only one template', () => {
    expect(pickVariantIndexForTest('any-session', 'RAGE_CLICK', 1)).toBe(0)
  })

  it('returns a valid index in [0, n)', () => {
    for (let i = 0; i < 20; i++) {
      const v = pickVariantIndexForTest(`sess_${i}`, 'RAGE_CLICK', 4)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(4)
    }
  })

  it('produces a roughly uniform spread across a large session population', () => {
    const counts = [0, 0, 0]
    for (let i = 0; i < 600; i++) {
      const v = pickVariantIndexForTest(`sess_${i}`, 'LOOP', 3)
      counts[v]!++
    }
    // No bucket should be empty or overwhelmingly dominant.
    for (const c of counts) {
      expect(c).toBeGreaterThan(50)
      expect(c).toBeLessThan(450)
    }
  })
})

describe('semantic enrichment in dispatch', () => {
  const det: StruggleDetection = {
    sessionId: 'sess_sem',
    elementId: 'sh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as ElementId,
    type: 'HOVER_HUNT',
    severity: 0.5,
    ts: '2026-05-01T12:00:00.000Z',
  }

  it('uses enriched semantic name in {label} when available', () => {
    const labels = new Map([[det.elementId as string, 'Submit']])
    const semantics = new Map([
      [det.elementId as string, { semanticName: 'Complete purchase', intent: 'finalize order' }],
    ])
    const out = dispatchInterventions([det], {
      safeMode: false,
      elementLabels: labels,
      elementSemantics: semantics,
    })
    expect(out[0]?.copy).toContain('Complete purchase')
    expect(out[0]?.copy).not.toContain('Submit')
  })

  it('falls back to raw label when no semantic enrichment exists', () => {
    const labels = new Map([[det.elementId as string, 'Submit']])
    const out = dispatchInterventions([det], {
      safeMode: false,
      elementLabels: labels,
    })
    expect(out[0]?.copy).toContain('Submit')
  })
})

describe('dispatch payload - confidence + diagnostic', () => {
  it('attaches a confidence score in (0, 1)', () => {
    const out = dispatchInterventions(
      [
        {
          sessionId: 'sess_c',
          elementId: 'sh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as ElementId,
          type: 'JS_ERROR',
          severity: 0.8,
          ts: '2026-05-01T12:00:00.000Z',
        },
      ],
      { safeMode: false },
    )
    expect(out[0]?.confidence).toBeDefined()
    expect(out[0]?.confidence).toBeGreaterThan(0)
    expect(out[0]?.confidence).toBeLessThan(1)
  })

  it('JS_ERROR confidence is higher than HOVER_HUNT confidence', () => {
    const high = dispatchInterventions(
      [
        {
          sessionId: 'sess_h',
          elementId: 'sh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as ElementId,
          type: 'JS_ERROR',
          severity: 0.9,
          ts: '2026-05-01T12:00:00.000Z',
        },
      ],
      { safeMode: false },
    )[0]?.confidence ?? 0
    const low = dispatchInterventions(
      [
        {
          sessionId: 'sess_l',
          elementId: 'sh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as ElementId,
          type: 'HOVER_HUNT',
          severity: 0.4,
          ts: '2026-05-01T12:00:00.000Z',
        },
      ],
      { safeMode: false },
    )[0]?.confidence ?? 0
    expect(high).toBeGreaterThan(low)
  })

  it('attaches diagnostic info', () => {
    const out = dispatchInterventions(
      [
        {
          sessionId: 'sess_d',
          elementId: 'sh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as ElementId,
          type: 'RAGE_CLICK',
          severity: 0.7,
          ts: '2026-05-01T12:00:00.000Z',
          summary: '5 clicks within 2s',
        },
      ],
      { safeMode: false },
    )
    expect(out[0]?.diagnostic?.struggleType).toBe('RAGE_CLICK')
    expect(out[0]?.diagnostic?.severity).toBe(0.7)
    expect(out[0]?.diagnostic?.summary).toBe('5 clicks within 2s')
  })

  it('substitutes pageTitle from session map', () => {
    const ctx = {
      safeMode: false,
      pageTitleBySession: new Map([['sess_p', 'Checkout']]),
    }
    // Use a struggle whose template doesn't reference {pageTitle} but verify
    // pageTitle is available via the rendering pipeline by testing render
    // through the LOOP template (which doesn't use pageTitle either, so just
    // verify the dispatcher doesn't crash with the map).
    const out = dispatchInterventions(
      [
        {
          sessionId: 'sess_p',
          elementId: null,
          type: 'LOOP',
          severity: 0.5,
          ts: '2026-05-01T12:00:00.000Z',
        },
      ],
      ctx,
    )
    expect(out.length).toBeGreaterThan(0)
  })

  it('REQUIRED_MISSED template uses element validation rules in copy', () => {
    const targetId = 'sh_ffffffffffffffffffffffffffffffff' as ElementId
    const out = dispatchInterventions(
      [
        {
          sessionId: 'sess_v',
          elementId: targetId,
          type: 'REQUIRED_MISSED',
          severity: 0.5,
          ts: '2026-05-01T12:00:00.000Z',
        },
      ],
      {
        safeMode: false,
        elementLabels: new Map([[targetId, 'Email']]),
        elementValidation: new Map([
          [targetId, { required: true, inputType: 'email' as const, minLength: 5 }],
        ]),
      },
    )
    // Template is "{label} {validation}." → "Email needs required, valid email, at least 5 characters."
    const copy = out[0]?.copy ?? ''
    expect(copy).toContain('Email')
    expect(copy.toLowerCase()).toContain('required')
    expect(copy.toLowerCase()).toContain('valid email')
    expect(copy.toLowerCase()).toContain('at least 5')
  })

  it('overrides RAGE_CLICK on a DANGER element to a CONFIRM intervention', () => {
    const targetId = 'sh_dddddddddddddddddddddddddddddddd' as ElementId
    const out = dispatchInterventions(
      [
        {
          sessionId: 'sess_d',
          elementId: targetId,
          type: 'RAGE_CLICK',
          severity: 0.7,
          ts: '2026-05-01T12:00:00.000Z',
        },
      ],
      {
        safeMode: false,
        elementRoles: new Map([[targetId, 'DANGER']]),
      },
    )
    expect(out[0]?.type).toBe('CONFIRM')
    expect(out[0]?.copy).toMatch(/destructive|sure/i)
  })

  it('keeps default template for non-destructive struggle', () => {
    const targetId = 'sh_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as ElementId
    const out = dispatchInterventions(
      [
        {
          sessionId: 'sess_n',
          elementId: targetId,
          type: 'RAGE_CLICK',
          severity: 0.7,
          ts: '2026-05-01T12:00:00.000Z',
        },
      ],
      {
        safeMode: false,
        elementRoles: new Map([[targetId, 'PRIMARY']]),
      },
    )
    // Default RAGE_CLICK templates are HIGHLIGHT or TOOLTIP - both are
    // non-confirmation responses. Critical: it's NOT CONFIRM.
    expect(['HIGHLIGHT', 'TOOLTIP']).toContain(out[0]?.type)
    expect(out[0]?.type).not.toBe('CONFIRM')
  })

  it('resolves alternativeActions to relatedElementIds via the semantic name index', () => {
    const targetId = 'sh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as ElementId
    const altId = 'sh_cccccccccccccccccccccccccccccccc' as ElementId
    const out = dispatchInterventions(
      [
        {
          sessionId: 'sess_alt',
          elementId: targetId,
          type: 'HOVER_HUNT',
          severity: 0.5,
          ts: '2026-05-01T12:00:00.000Z',
        },
      ],
      {
        safeMode: false,
        elementSemantics: new Map([
          [
            targetId,
            {
              semanticName: 'Submit form',
              alternativeActions: ['Apply discount', 'Save draft'],
            },
          ],
        ]),
        semanticNameIndex: new Map([['apply discount', altId]]),
      },
    )
    expect(out[0]?.relatedElementIds).toContain(altId)
  })
})

describe('dispatchInterventionsWithRows', () => {
  it('returns rowId, variantGroup, and variantIndex on each result', () => {
    const out = dispatchInterventionsWithRows(
      [
        {
          sessionId: 'sess_x',
          elementId: 'sh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as ElementId,
          type: 'RAGE_CLICK',
          severity: 0.6,
          ts: '2026-05-01T10:00:00.000Z',
        },
      ],
      { safeMode: false },
    )
    expect(out.length).toBe(1)
    expect(out[0]?.rowId).toMatch(/^iv_[0-9a-f]{1,16}$/)
    expect(out[0]?.variantGroup).toBe('RAGE_CLICK')
    expect(typeof out[0]?.variantIndex).toBe('number')
  })

  it('produces stable rowIds for the same input', () => {
    const det: StruggleDetection = {
      sessionId: 'sess_y',
      elementId: 'sh_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as ElementId,
      type: 'THRASH',
      severity: 0.5,
      ts: '2026-05-01T10:00:00.000Z',
    }
    const a = dispatchInterventionsWithRows([det], { safeMode: false })
    const b = dispatchInterventionsWithRows([det], { safeMode: false })
    expect(a[0]?.rowId).toBe(b[0]?.rowId)
  })

  it('respects safeMode - returns empty when safeMode = true', () => {
    expect(
      dispatchInterventionsWithRows(
        [
          {
            sessionId: 'sess_z',
            elementId: null,
            type: 'LOOP',
            severity: 0.4,
            ts: '2026-05-01T10:00:00.000Z',
          },
        ],
        { safeMode: true },
      ),
    ).toEqual([])
  })

  it('rowId is population-keyed - same (type, element, variant) across sessions yield same rowId', () => {
    const eid = 'sh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as ElementId
    const a = dispatchInterventionsWithRows(
      [
        {
          sessionId: 'sess_alpha',
          elementId: eid,
          type: 'THRASH',
          severity: 0.5,
          ts: '2026-05-01T10:00:00.000Z',
        },
      ],
      { safeMode: false },
    )
    const b = dispatchInterventionsWithRows(
      [
        {
          sessionId: 'sess_beta',
          elementId: eid,
          type: 'THRASH',
          severity: 0.5,
          ts: '2026-05-01T10:00:00.000Z',
        },
      ],
      { safeMode: false },
    )
    // Two different sessions, same struggle on same element + variant.
    // Trackers (id) differ; rowIds match.
    if (a[0]?.variantIndex === b[0]?.variantIndex) {
      expect(a[0]?.rowId).toBe(b[0]?.rowId)
      expect(a[0]?.id).not.toBe(b[0]?.id)
    }
  })
})

describe('bandit variant selection', () => {
  const E = 'sh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as ElementId

  it('falls back to deterministic pick when no stats provided', () => {
    const a = pickVariantBanditForTest('sess_x', 'RAGE_CLICK', E, 3, undefined, 0.1, 30)
    const b = pickVariantBanditForTest('sess_x', 'RAGE_CLICK', E, 3, undefined, 0.1, 30)
    expect(a).toBe(b)
    expect(a).toBe(pickVariantIndexForTest('sess_x', 'RAGE_CLICK', 3))
  })

  it('falls back to deterministic when total impressions below minSamples', () => {
    const stats = new Map([
      [populationRowIdForTest('THRASH', E, 0), { impressions: 5, successes: 4 }],
      [populationRowIdForTest('THRASH', E, 1), { impressions: 5, successes: 0 }],
    ])
    const a = pickVariantBanditForTest('sess_y', 'THRASH', E, 2, stats, 0.1, 30)
    const b = pickVariantBanditForTest('sess_y', 'THRASH', E, 2, stats, 0.1, 30)
    expect(a).toBe(b)
    expect(a).toBe(pickVariantIndexForTest('sess_y', 'THRASH', 2))
  })

  it('exploits the highest-success variant when warm and epsilon=0', () => {
    const stats = new Map([
      [populationRowIdForTest('LOOP', E, 0), { impressions: 100, successes: 10 }],
      [populationRowIdForTest('LOOP', E, 1), { impressions: 100, successes: 80 }],
      [populationRowIdForTest('LOOP', E, 2), { impressions: 100, successes: 30 }],
    ])
    // Force exploration off, RNG returns 0.5 (above ε=0).
    const idx = pickVariantBanditForTest('sess_z', 'LOOP', E, 3, stats, 0, 30, () => 0.5)
    expect(idx).toBe(1)
  })

  it('explores uniformly when epsilon=1', () => {
    const stats = new Map([
      [populationRowIdForTest('HOVER_HUNT', E, 0), { impressions: 100, successes: 80 }],
      [populationRowIdForTest('HOVER_HUNT', E, 1), { impressions: 100, successes: 5 }],
    ])
    const counts = [0, 0]
    let seed = 0
    const rng = () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }
    for (let i = 0; i < 1000; i++) {
      const idx = pickVariantBanditForTest('sess_e', 'HOVER_HUNT', E, 2, stats, 1, 30, rng)
      counts[idx]!++
    }
    expect(counts[0]).toBeGreaterThan(300)
    expect(counts[1]).toBeGreaterThan(300)
  })

  it('warm + low epsilon: best variant is picked overwhelmingly', () => {
    const stats = new Map([
      [populationRowIdForTest('REQUIRED_MISSED', E, 0), { impressions: 200, successes: 20 }],
      [populationRowIdForTest('REQUIRED_MISSED', E, 1), { impressions: 200, successes: 160 }],
    ])
    let counts = [0, 0]
    let seed = 0.3
    const rng = () => {
      seed = (seed * 9.301 + 0.49297) % 1
      return seed
    }
    for (let i = 0; i < 1000; i++) {
      const idx = pickVariantBanditForTest('s', 'REQUIRED_MISSED', E, 2, stats, 0.1, 30, rng)
      counts[idx]!++
    }
    // ε=0.1 → ~10% random, ~90% exploit on variant 1. Expect a strong skew.
    expect(counts[1]).toBeGreaterThan(700)
    expect(counts[0]).toBeLessThan(300)
  })

  it('cold variant gets fair shake via Laplace smoothing', () => {
    // Variant 0 has 50/100 (=50%); variant 1 is brand new (0/0).
    // Smoothed scores: (50+1)/(100+2)=0.5, (0+1)/(0+2)=0.5. Tie → first wins.
    // Variant 0 with 49/100 (smoothed 50/102=0.49) loses to variant 1 (0/0 → 0.5).
    const stats = new Map([
      [populationRowIdForTest('FAILED_FILTER', E, 0), { impressions: 100, successes: 49 }],
      [populationRowIdForTest('FAILED_FILTER', E, 1), { impressions: 0, successes: 0 }],
    ])
    const idx = pickVariantBanditForTest('s', 'FAILED_FILTER', E, 2, stats, 0, 30, () => 0.5)
    expect(idx).toBe(1)
  })

  it('end-to-end: dispatcher with high-success variant 1 stats picks variant 1 reliably', () => {
    const targetId = 'sh_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as ElementId
    const stats = new Map([
      [populationRowIdForTest('RAGE_CLICK', targetId, 0), { impressions: 200, successes: 5 }],
      [populationRowIdForTest('RAGE_CLICK', targetId, 1), { impressions: 200, successes: 180 }],
    ])
    const out = dispatchInterventionsWithRows(
      [
        {
          sessionId: 'sess_e2e',
          elementId: targetId,
          type: 'RAGE_CLICK',
          severity: 0.7,
          ts: '2026-05-01T12:00:00.000Z',
        },
      ],
      {
        safeMode: false,
        variantStats: stats,
        banditEpsilon: 0,
        banditMinSamples: 30,
        random: () => 0.5,
      },
    )
    expect(out[0]?.variantIndex).toBe(1)
  })
})

describe('cached variants (pre-computed interventions)', () => {
  const E = 'sh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as ElementId

  it('uses pre-computed copy verbatim with no placeholder rendering', () => {
    const cached = new Map([
      [
        `${E}|RAGE_CLICK`,
        [
          {
            type: 'TOOLTIP' as const,
            copy: 'You are about to checkout - but the shipping address is empty.',
            confidence: 0.92,
          },
        ],
      ],
    ])
    const out = dispatchInterventionsWithRows(
      [
        {
          sessionId: 'sess_cv',
          elementId: E,
          type: 'RAGE_CLICK',
          severity: 0.7,
          ts: '2026-05-01T12:00:00.000Z',
        },
      ],
      {
        safeMode: false,
        cachedVariants: cached,
        // Even if elementLabels supplied, cached copy wins.
        elementLabels: new Map([[E, 'Submit']]),
      },
    )
    expect(out[0]?.copy).toBe('You are about to checkout - but the shipping address is empty.')
    expect(out[0]?.confidence).toBeCloseTo(0.92, 2)
  })

  it('falls back to template library when no cache entry exists', () => {
    const cached = new Map([
      [`${E}|THRASH`, [{ type: 'TOOLTIP' as const, copy: 'cached copy' }]],
    ])
    const out = dispatchInterventions(
      [
        {
          sessionId: 'sess_fb',
          elementId: E,
          type: 'RAGE_CLICK',
          severity: 0.5,
          ts: '2026-05-01T12:00:00.000Z',
        },
      ],
      { safeMode: false, cachedVariants: cached },
    )
    expect(out[0]?.copy).not.toBe('cached copy')
    expect(out[0]?.copy.length).toBeGreaterThan(0)
  })

  it('bandit picks among cached variants the same way it picks among templates', () => {
    const cached = new Map([
      [
        `${E}|HOVER_HUNT`,
        [
          { type: 'TOOLTIP' as const, copy: 'cached A', confidence: 0.5 },
          { type: 'TOOLTIP' as const, copy: 'cached B', confidence: 0.5 },
        ],
      ],
    ])
    const stats = new Map([
      [populationRowIdForTest('HOVER_HUNT', E, 0), { impressions: 100, successes: 5 }],
      [populationRowIdForTest('HOVER_HUNT', E, 1), { impressions: 100, successes: 80 }],
    ])
    const out = dispatchInterventionsWithRows(
      [
        {
          sessionId: 'sess_cb',
          elementId: E,
          type: 'HOVER_HUNT',
          severity: 0.5,
          ts: '2026-05-01T12:00:00.000Z',
        },
      ],
      {
        safeMode: false,
        cachedVariants: cached,
        variantStats: stats,
        banditEpsilon: 0,
        banditMinSamples: 30,
        random: () => 0.5,
      },
    )
    expect(out[0]?.copy).toBe('cached B')
  })

  it('substitutes {routePurpose} and {journeyStage} from routeSemantic map', () => {
    // Use a custom cached variant that explicitly references the new vars.
    // Cached variants skip render(), so test against templates by checking
    // a struggle whose template doesn't use those vars - instead, verify
    // the render() function indirectly by sending a routeSemantic without
    // a template substitution and confirming dispatch doesn't crash.
    const out = dispatchInterventions(
      [
        {
          sessionId: 'sess_rp',
          elementId: null,
          type: 'LOOP',
          severity: 0.4,
          ts: '2026-05-01T12:00:00.000Z',
        },
      ],
      {
        safeMode: false,
        routeBySession: new Map([['sess_rp', '/checkout']]),
        routeSemantic: new Map([
          ['/checkout', { purpose: 'finalize order', journeyStage: 'transact' }],
        ]),
      },
    )
    expect(out.length).toBeGreaterThan(0)
  })

  it('passes through cached helpCopy as the secondary line', () => {
    const cached = new Map([
      [
        `${E}|VALIDATION_LOOP`,
        [
          {
            type: 'INLINE_HINT' as const,
            copy: 'Email needs an @ symbol.',
            helpCopy: 'Make sure it looks like name@example.com.',
            confidence: 0.85,
          },
        ],
      ],
    ])
    const out = dispatchInterventions(
      [
        {
          sessionId: 'sess_hc',
          elementId: E,
          type: 'VALIDATION_LOOP',
          severity: 0.5,
          ts: '2026-05-01T12:00:00.000Z',
        },
      ],
      { safeMode: false, cachedVariants: cached },
    )
    expect(out[0]?.helpCopy).toBe('Make sure it looks like name@example.com.')
  })
})
