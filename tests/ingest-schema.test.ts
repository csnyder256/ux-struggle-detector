import { describe, expect, it } from 'vitest'
import { BatchSchema } from '@/lib/ingest/schema'
import { EVENT_SCHEMA_VERSION, MAX_ROUTE_LENGTH } from '@/lib/types/events'

function event(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    idempotencyKey: 'evt-1',
    sessionId: 'session-1',
    userIdHash: null,
    elementId: null,
    route: '/checkout',
    eventType: 'CLICK',
    ts: '2026-09-24T12:00:00.000Z',
    ...overrides,
  }
}

function batch(...events: unknown[]) {
  return { schemaVersion: EVENT_SCHEMA_VERSION, clockOffsetMs: 0, events }
}

describe('ingest batch schema', () => {
  it('passes ordinary values through unchanged', () => {
    const parsed = BatchSchema.parse(batch(event({ page: { title: 'Checkout' } })))
    expect(parsed.events[0]!.route).toBe('/checkout')
    expect(parsed.events[0]!.page?.title).toBe('Checkout')
  })

  // One over-long field used to fail the whole batch, and every event in the
  // flush went with it.
  it('cuts over-long page and element text instead of rejecting the batch', () => {
    const parsed = BatchSchema.safeParse(
      batch(
        event({
          route: '/#/' + 'r'.repeat(5000),
          page: {
            title: 't'.repeat(600),
            h1: 'h'.repeat(600),
            referrer: 'https://example.test/?' + 'q'.repeat(4000),
          },
          element: {
            label: 'l'.repeat(900),
            role: 'x'.repeat(100),
            formId: 'f'.repeat(300),
            validity: 'v'.repeat(300),
          },
        }),
        event({ idempotencyKey: 'evt-2' }),
      ),
    )
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const [first, second] = parsed.data.events
    expect(first!.route).toHaveLength(MAX_ROUTE_LENGTH)
    expect(first!.page?.title).toHaveLength(500)
    expect(first!.page?.h1).toHaveLength(500)
    expect(first!.page?.referrer).toHaveLength(2048)
    expect(first!.element?.label).toHaveLength(500)
    expect(first!.element?.role).toHaveLength(40)
    expect(first!.element?.formId).toHaveLength(120)
    expect(first!.element?.validity).toHaveLength(200)
    expect(second!.idempotencyKey).toBe('evt-2')
  })

  it('still rejects bad identifiers and an empty route', () => {
    expect(BatchSchema.safeParse(batch(event({ idempotencyKey: 'k'.repeat(129) }))).success).toBe(false)
    expect(BatchSchema.safeParse(batch(event({ elementId: 'not-an-element-id' }))).success).toBe(false)
    expect(BatchSchema.safeParse(batch(event({ route: '' }))).success).toBe(false)
  })
})
