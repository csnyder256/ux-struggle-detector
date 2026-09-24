/**
 * Wire schema for POST /api/events.
 *
 * The route validates a batch as a whole, so a single field that fails
 * validation drops every event in the flush. Descriptive text the SDK copies
 * off the customer's page (route, title, h1, referrer, element label, role,
 * form id, validity flags) is therefore cut to its limit instead of rejected:
 * a page with a 600-character title, or an SDK build from before a limit
 * existed, still reports its events. Identifiers and enums keep hard limits.
 */

import { z } from 'zod'
import { EVENT_SCHEMA_VERSION, MAX_ROUTE_LENGTH } from '@/lib/types/events'

/** A string cut to `max` characters rather than failing validation. */
const clipped = (max: number) => z.string().transform((s) => s.slice(0, max))

const PageContextSchema = z
  .object({
    title: clipped(500).optional(),
    h1: clipped(500).optional(),
    viewportW: z.number().int().nonnegative().optional(),
    viewportH: z.number().int().nonnegative().optional(),
    formFactor: z.enum(['mobile', 'tablet', 'desktop']).optional(),
    referrer: clipped(2048).optional(),
    ageMs: z.number().int().nonnegative().optional(),
  })
  .passthrough()
  .optional()

const ElementContextSchema = z
  .object({
    label: clipped(500).optional(),
    role: clipped(40).optional(),
    formId: clipped(120).optional(),
    formValid: z.boolean().optional(),
    touched: z.boolean().optional(),
    dirty: z.boolean().optional(),
    valueLength: z.number().int().nonnegative().optional(),
    validity: clipped(200).optional(),
    disabled: z.boolean().optional(),
    dead: z.boolean().optional(),
  })
  .passthrough()
  .optional()

const SCHEMA_VERSION_LITERAL = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(EVENT_SCHEMA_VERSION),
])

const RuntimeEventSchema = z.object({
  schemaVersion: SCHEMA_VERSION_LITERAL,
  idempotencyKey: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  userIdHash: z.string().nullable(),
  elementId: z
    .string()
    .regex(/^sh_[0-9a-f]{32}$/)
    .nullable(),
  route: z
    .string()
    .min(1)
    .transform((s) => s.slice(0, MAX_ROUTE_LENGTH)),
  eventType: z.enum([
    'CLICK',
    'INPUT_CHANGE',
    'SUBMIT',
    'NAVIGATION',
    'HOVER',
    'SCROLL',
    'DWELL',
    'PASTE',
    'COPY',
    'FOCUS',
    'BLUR',
    'KEY_DOWN',
    'JS_ERROR',
    'VALIDATION_ERROR',
    'CUSTOM',
  ]),
  ts: z.string().datetime(),
  meta: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  page: PageContextSchema,
  element: ElementContextSchema,
})

export const BatchSchema = z.object({
  schemaVersion: SCHEMA_VERSION_LITERAL,
  clockOffsetMs: z.number(),
  events: z.array(RuntimeEventSchema).max(500),
})
