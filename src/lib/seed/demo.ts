/**
 * Demo seed - fills an org with synthetic mapped elements, runtime events,
 * struggle events, and interventions so the dashboard shows real-looking
 * data without needing actual users on a real app yet.
 *
 * Idempotent-ish: clears the org's events / struggles / interventions / impressions
 * first, then writes fresh fixtures. Mapped UIElements are kept (so a
 * post-seed re-map of a real repo is not required to see the seed payoff).
 */

import { prisma } from '@/lib/db'
import { ALL_STRUGGLE_TYPES, type StruggleType } from '@/lib/types/events'
import { hashElementId, hashLabel, type ElementId } from '@/lib/types/ui-map'

const DEMO_ROUTES = ['/checkout', '/dashboard', '/settings', '/billing', '/help'] as const

const DEMO_ELEMENTS: Array<{
  label: string
  elementType: 'BUTTON' | 'INPUT' | 'FORM' | 'LINK' | 'SELECT' | 'CUSTOM'
  filePath: string
  routeTarget: string
}> = [
  { label: 'Complete purchase', elementType: 'BUTTON', filePath: 'demo/Checkout.tsx', routeTarget: '/checkout' },
  { label: 'Apply discount', elementType: 'BUTTON', filePath: 'demo/Checkout.tsx', routeTarget: '/checkout' },
  { label: 'Card number', elementType: 'INPUT', filePath: 'demo/PaymentForm.tsx', routeTarget: '/checkout' },
  { label: 'Save settings', elementType: 'BUTTON', filePath: 'demo/Settings.tsx', routeTarget: '/settings' },
  { label: 'Search', elementType: 'INPUT', filePath: 'demo/Header.tsx', routeTarget: '/dashboard' },
  { label: 'Sign in', elementType: 'FORM', filePath: 'demo/SignInForm.tsx', routeTarget: '/sign-in' },
  { label: 'Help', elementType: 'LINK', filePath: 'demo/Header.tsx', routeTarget: '/help' },
  { label: 'Cancel subscription', elementType: 'BUTTON', filePath: 'demo/Billing.tsx', routeTarget: '/billing' },
]

export interface SeedResult {
  ok: boolean
  cleared: { events: number; struggles: number; interventions: number; impressions: number }
  created: { elements: number; events: number; struggles: number; interventions: number }
}

export async function seedDemoData(orgId: string): Promise<SeedResult> {
  // ── Clear existing demo-volatile data
  const cleared = {
    events: (await prisma.userEvent.deleteMany({ where: { orgId } })).count,
    struggles: (await prisma.struggleEvent.deleteMany({ where: { orgId } })).count,
    impressions: (await prisma.interventionImpression.deleteMany({ where: { orgId } })).count,
    interventions: (await prisma.intervention.deleteMany({ where: { orgId } })).count,
  }

  // ── Ensure mapped elements exist for the demo
  const elementsToCreate: Array<{ id: ElementId; label: string; el: (typeof DEMO_ELEMENTS)[number] }> = []
  for (let i = 0; i < DEMO_ELEMENTS.length; i++) {
    const el = DEMO_ELEMENTS[i]!
    const id = await hashElementId({
      orgId,
      filePath: el.filePath,
      nodeDescriptor: `Demo>${el.elementType.toLowerCase()}[${i}]`,
    })
    elementsToCreate.push({ id, label: el.label, el })
  }

  // Upsert each (deleteMany above didn't touch UIElements; we re-upsert here to
  // ensure the demo elements exist regardless of any prior mapping).
  for (const { id, label, el } of elementsToCreate) {
    const labelHash = await hashLabel(label)
    await prisma.uIElement.upsert({
      where: { id },
      create: {
        id,
        orgId,
        filePath: el.filePath,
        componentName: 'Demo',
        elementType: el.elementType,
        labelRaw: label,
        labelHash,
        handlerFunction: null,
        routeTarget: el.routeTarget,
      },
      update: { labelRaw: label, labelHash, routeTarget: el.routeTarget },
    })
  }

  // ── Routes
  for (const r of DEMO_ROUTES) {
    await prisma.uIRoute.upsert({
      where: { orgId_path: { orgId, path: r } },
      create: { orgId, path: r, parentPath: null, entryPoints: [] },
      update: {},
    })
  }

  // ── Events: synthesize a few sessions of plausible activity
  const SESSIONS = 8
  const baseTs = Date.now() - 1000 * 60 * 60 * 6 // 6h ago
  const events: Array<{
    sessionId: string
    elementId: ElementId | null
    route: string
    eventType: 'CLICK' | 'INPUT_CHANGE' | 'SUBMIT' | 'NAVIGATION' | 'CUSTOM'
    ts: Date
    idempotencyKey: string
  }> = []
  for (let s = 0; s < SESSIONS; s++) {
    const sessionId = `demo_sess_${s}`
    const sessionStart = baseTs + s * 1000 * 60 * 5 // sessions spread 5m apart
    let cursor = sessionStart
    const route = DEMO_ROUTES[s % DEMO_ROUTES.length]!
    events.push({
      sessionId,
      elementId: null,
      route,
      eventType: 'NAVIGATION',
      ts: new Date(cursor),
      idempotencyKey: `seed_${s}_nav`,
    })
    // Pick 3-5 elements to interact with.
    const elsForSession = elementsToCreate
      .filter((e) => e.el.routeTarget === route || Math.random() < 0.3)
      .slice(0, 4)
    for (let k = 0; k < elsForSession.length; k++) {
      const el = elsForSession[k]!
      cursor += 800 + Math.floor(Math.random() * 1200)
      events.push({
        sessionId,
        elementId: el.id,
        route,
        eventType: el.el.elementType === 'INPUT' ? 'INPUT_CHANGE' : 'CLICK',
        ts: new Date(cursor),
        idempotencyKey: `seed_${s}_${k}`,
      })
    }
    // Some sessions: rage click
    if (s % 3 === 0 && elsForSession[0]) {
      const target = elsForSession[0]
      for (let r = 0; r < 4; r++) {
        cursor += 250
        events.push({
          sessionId,
          elementId: target.id,
          route,
          eventType: 'CLICK',
          ts: new Date(cursor),
          idempotencyKey: `seed_${s}_rage_${r}`,
        })
      }
    }
  }
  if (events.length > 0) {
    await prisma.userEvent.createMany({
      data: events.map((e) => ({
        orgId,
        sessionId: e.sessionId,
        elementId: e.elementId,
        route: e.route,
        eventType: e.eventType,
        ts: e.ts,
        idempotencyKey: e.idempotencyKey,
        userIdHash: null,
        schemaVersion: 2,
      })),
      skipDuplicates: true,
    })
  }

  // ── Struggle events: synthesize a sampling of struggle types
  const struggleSubset: StruggleType[] = [
    'RAGE_CLICK',
    'LOOP',
    'THRASH',
    'SILENT_FAIL',
    'HOVER_HUNT',
    'DEAD_CLICK',
    'BACK_THRASH',
    'PASTE_REPEAT',
  ].filter((t): t is StruggleType => ALL_STRUGGLE_TYPES.includes(t as StruggleType))

  let createdStruggles = 0
  for (let i = 0; i < 16; i++) {
    const sessionId = `demo_sess_${i % SESSIONS}`
    const el = elementsToCreate[i % elementsToCreate.length]!
    const type = struggleSubset[i % struggleSubset.length]!
    const ts = new Date(baseTs + i * 1000 * 60 * 18) // spread across last 5h
    try {
      await prisma.struggleEvent.create({
        data: {
          orgId,
          sessionId,
          elementId: el.id,
          type: type as never,
          severity: 0.4 + Math.random() * 0.5,
          ts,
        },
      })
      createdStruggles++
    } catch {
      // enum mismatch (pre-migration) - skip
    }
  }

  // ── Interventions + impressions: TWO variants per (element, struggleType)
  // pair so the bandit observability dashboard has data to compare. Variant 0
  // wins narrowly on some, decisively on others - typical bandit-data shape.
  let createdInterventions = 0
  for (let i = 0; i < 6; i++) {
    const el = elementsToCreate[i]!
    const struggleType = struggleSubset[i % struggleSubset.length]!
    // Population-keyed row id format matching dispatcher.populationRowId.
    function rowId(variantIndex: number): string {
      const s = `${struggleType}|${el.id}|v${variantIndex}`
      let h1 = 0
      let h2 = 0
      for (let k = 0; k < s.length; k++) {
        const c = s.charCodeAt(k)
        h1 = (h1 << 5) - h1 + c
        h2 = (h2 * 31 + c) | 0
        h1 |= 0
      }
      const hex = (Math.abs(h1).toString(16) + Math.abs(h2).toString(16))
        .slice(0, 16)
        .padEnd(16, '0')
      return `iv_${hex}`
    }
    // Variant 0: usually losing - direct, terse copy. ~25% success.
    // Variant 1: usually winning - empathetic, helpful. ~65% success.
    const variants: Array<{ idx: number; copy: string; impressions: number; succRate: number }> = [
      {
        idx: 0,
        copy: `Try the ${el.label.toLowerCase()} button`,
        impressions: 60 + Math.floor(Math.random() * 50),
        succRate: 0.18 + Math.random() * 0.18,
      },
      {
        idx: 1,
        copy: `Looks like you're trying to ${el.label.toLowerCase()} - here's what to do next.`,
        impressions: 60 + Math.floor(Math.random() * 50),
        succRate: 0.55 + Math.random() * 0.25,
      },
    ]
    for (const v of variants) {
      const successes = Math.round(v.impressions * v.succRate)
      const dismissals = v.impressions - successes
      try {
        await prisma.intervention.create({
          data: {
            id: rowId(v.idx),
            orgId,
            elementId: el.id,
            type: 'HIGHLIGHT' as never,
            config: { type: 'HIGHLIGHT', copy: v.copy } as never,
            variantGroup: struggleType,
            enabled: true,
            impressions: v.impressions,
            successes,
            dismissals,
            successRate: v.impressions > 0 ? successes / v.impressions : 0,
          },
        })
        createdInterventions++
      } catch {
        // skip on FK / type mismatch
      }
    }
  }

  return {
    ok: true,
    cleared,
    created: {
      elements: elementsToCreate.length,
      events: events.length,
      struggles: createdStruggles,
      interventions: createdInterventions,
    },
  }
}

export async function clearDemoData(orgId: string): Promise<{ deleted: number }> {
  const a = await prisma.interventionImpression.deleteMany({ where: { orgId } })
  const b = await prisma.intervention.deleteMany({ where: { orgId } })
  const c = await prisma.struggleEvent.deleteMany({ where: { orgId } })
  const d = await prisma.userEvent.deleteMany({ where: { orgId } })
  return { deleted: a.count + b.count + c.count + d.count }
}
