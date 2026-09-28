/**
 * Real-browser evidence for PR #38, captured with headless Chromium.
 *
 * The other SDK suites run against jsdom, which is a DOM implementation, not a
 * browser: it does not compute `badInput` and its constraint handling is an
 * approximation. This file drives the ACTUAL built SDK bundle (`public/sdk.js`)
 * inside REAL Chromium (the host binary at /usr/bin/chromium), exercises the
 * browser's own constraint-validation API, pushes what the SDK really emitted
 * through the real ingest schema, and renders real dispatcher copy.
 *
 * It writes a full transcript to docs/browser-evidence.md, so the PR's claims
 * are backed by a command and its output rather than by a DOM shim.
 *
 * Run:  pnpm exec vitest run tests/browser-evidence.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { RuntimeEventSchemaExport } from '@/lib/ingest/schema'
import { dispatchInterventions } from '@/lib/interventions/dispatcher'

const ROOT = resolve(__dirname, '..')
const CHROMIUM = '/usr/bin/chromium'

interface Captured {
  emitted: number
  withValidity: Array<Record<string, unknown>>
  eventTypes: string[]
}

const evidence: Array<{ title: string; value: unknown }> = []
let browser: Browser

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

beforeAll(async () => {
  browser = await chromium.launch({ executablePath: CHROMIUM })
}, 60_000)

afterAll(async () => {
  await browser?.close()
})

describe('real Chromium evidence', () => {
  it('captures constraint state, SDK output and the server contract', async () => {
    const sdkSource = readFileSync(resolve(ROOT, 'public/sdk.js'), 'utf8')
    const sdkHash = sha256(resolve(ROOT, 'public/sdk.js'))
    const minHash = sha256(resolve(ROOT, 'public/sdk.min.js'))
    const head = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim()
    const chromiumVersion = execSync(`${CHROMIUM} --version`).toString().trim()

    const page = await browser.newPage()

    // ── 1. The browser's own constraint API, no SDK involved ───────────────
    await page.setContent('<!doctype html><html><body></body></html>')
    const constraintProbe = await page.evaluate(() => {
      const form = document.createElement('form')
      form.innerHTML = `
        <input id="vat" name="vat">
        <input id="qty" name="qty" type="number" min="1" step="5" value="3">
        <input id="under" name="under" type="number" min="10" value="3">
      `
      document.body.appendChild(form)
      const vat = document.getElementById('vat') as HTMLInputElement
      const qty = document.getElementById('qty') as HTMLInputElement
      const under = document.getElementById('under') as HTMLInputElement

      // A page calling the browser's REAL setCustomValidity().
      vat.setCustomValidity('That is a card number, not a VAT ID.')

      const snap = (el: HTMLInputElement) => ({
        valid: el.checkValidity(),
        message: el.validationMessage,
        customError: el.validity.customError,
        badInput: el.validity.badInput,
        rangeUnderflow: el.validity.rangeUnderflow,
        stepMismatch: el.validity.stepMismatch,
        valueMissing: el.validity.valueMissing,
        value: el.value,
      })
      return {
        vatCustomMessage: snap(vat),
        // value=3 with min=1 step=5: allowed are 1,6,11 -> stepMismatch, and the
        // browser names the two nearest valid values (1 and 6).
        numericStep: snap(qty),
        rangeUnderflow: snap(under),
      }
    })
    evidence.push({ title: '1. Real Chromium constraint API (no SDK)', value: constraintProbe })

    // ── 1b. badInput — probed, and reported honestly ───────────────────────
    // badInput is raised only by the real editing pipeline. In headless
    // Chromium 154 the number/date controls FILTER or CLAMP typed text, so
    // neither real keystrokes nor programmatic assignment produces the flag:
    // `type="number"` rejects non-numeric keys and `.value='abc'` is sanitised
    // to ''. This probe records what the browser actually does, so the claim
    // stays honest - badInput is NOT verified here, and says so.
    await page.setContent(
      '<!doctype html><html><body><input id="n" name="n" type="number"></body></html>',
    )
    await page.focus('#n')
    await page.keyboard.type('abc')
    const badInputProbe = await page.evaluate(() => {
      const n = document.getElementById('n') as HTMLInputElement
      return {
        typed: 'abc',
        value: n.value,
        valid: n.checkValidity(),
        badInput: n.validity.badInput,
        message: n.validationMessage,
      }
    })
    evidence.push({
      title: '1b. Real Chromium badInput state (not reproducible; see note)',
      value: badInputProbe,
    })

    // ── 2. The real SDK bundle, inside real Chromium ───────────────────────
    await page.setContent('<!doctype html><html><body></body></html>')
    await page.addScriptTag({ content: sdkSource })
    const sdkCapture = (await page.evaluate(async () => {
      const w = window as unknown as {
        ClarusHeal?: { initSelfHealing: (o: Record<string, unknown>) => void }
      }
      if (!w.ClarusHeal) return { error: 'bundle did not define ClarusHeal' }

      const sent: Array<Record<string, unknown>> = []
      window.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
        try {
          if (typeof init?.body === 'string') sent.push(JSON.parse(init.body))
        } catch {
          /* ignore */
        }
        return new Response('{"interventions":[]}', { status: 200 })
      }

      const form = document.createElement('form')
      form.innerHTML = `
        <input id="vat" name="vat">
        <input id="qty" name="qty" type="number" min="1" step="5" value="3">
      `
      document.body.appendChild(form)
      const vat = document.getElementById('vat') as HTMLInputElement
      const qty = document.getElementById('qty') as HTMLInputElement

      w.ClarusHeal.initSelfHealing({
        orgId: 'org_evidence',
        endpoint: '/api/events',
        flushIntervalMs: 50,
      })

      const fire = (el: HTMLInputElement) => {
        el.focus()
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }
      vat.setCustomValidity('That is a card number, not a VAT ID.')
      fire(vat)
      fire(qty)
      // qty value=3 fails stepMismatch on min=1 step=5.
      await new Promise((r) => setTimeout(r, 500))

      const events = sent.flatMap((b) =>
        Array.isArray(b.events) ? (b.events as Array<Record<string, unknown>>) : [],
      )
      return {
        emitted: events.length,
        withValidity: events.filter((e) => {
          const el = e.element as Record<string, unknown> | undefined
          return el && typeof el.validity === 'string' && el.validity.length > 0
        }),
        eventTypes: events.map((e) => e.eventType),
      }
    })) as Captured
    evidence.push({ title: '2. Real SDK bundle: captured events', value: sdkCapture })

    await page.close()

    // ── 3. Browser output through the REAL ingest schema + dispatcher ──────
    const failing = sdkCapture.withValidity.find((e) =>
      String((e.element as Record<string, unknown>)?.validity ?? '').includes('customError'),
    )
    expect(failing, 'the browser produced a customError event').toBeTruthy()
    const parsed = RuntimeEventSchemaExport.safeParse(failing)
    expect(parsed.success, JSON.stringify(parsed)).toBe(true)
    const data = parsed.success ? parsed.data : null
    const message = data?.element?.validationMessage as string
    expect(data?.element?.validity).toContain('customError')
    expect(message).toBe('That is a card number, not a VAT ID.')

    const elementId = (data?.elementId as string) ?? 'sh_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const dispatched = dispatchInterventions(
      [
        {
          sessionId: data!.sessionId,
          elementId: elementId as never,
          type: 'FORMAT_ERROR',
          severity: 0.5,
          ts: data!.ts,
        },
      ],
      {
        safeMode: false,
        elementLabels: new Map([[elementId, 'Tax ID']]),
        validationMessageByElement: new Map([[elementId, message]]),
      },
    )
    const contract = {
      schemaAccepted: parsed.success,
      capturedValidity: data?.element?.validity,
      capturedMessage: message,
      renderedCopy: dispatched[0]?.copy,
      copyCarriesBrowserMessage: Boolean(dispatched[0]?.copy?.includes(message)),
    }
    evidence.push({
      title: '3. Browser-captured event -> real ingest schema -> real dispatcher',
      value: contract,
    })
    expect(contract.copyCarriesBrowserMessage, contract.renderedCopy).toBe(true)

    // ── 4. Assertions that make this evidence, not just a transcript ───────
    const probe = constraintProbe as Record<string, Record<string, unknown>>
    expect(probe.vatCustomMessage!.customError).toBe(true)
    expect(probe.vatCustomMessage!.message).toBe('That is a card number, not a VAT ID.')
    // min=1 step=5 must be a step failure, and the browser's own message must
    // name 1 and 6 - the "step is anchored on min" fact the dispatcher encodes.
    expect(probe.numericStep!.stepMismatch).toBe(true)
    expect(String(probe.numericStep!.message)).toMatch(/1 and 6/)
    expect(probe.rangeUnderflow!.rangeUnderflow).toBe(true)
    const bad = badInputProbe as Record<string, unknown>
    // Honest browser finding: Chromium 154 does NOT expose badInput through
    // automation - it filters/clamps instead. Assert what was observed, so this
    // stays evidence and never becomes a false claim of browser verification.
    expect(bad.badInput, 'Chromium filters the input instead of flagging it').toBe(false)
    expect(bad.value).toBe('')
    expect(sdkCapture.withValidity.length).toBeGreaterThan(0)

    // ── 5. Write the transcript ───────────────────────────────────────────
    const lines: string[] = []
    lines.push('# Browser evidence — runtime validation & SDK capture (PR #38)')
    lines.push('')
    lines.push('Captured with **headless Chromium driving the built SDK bundle** — not jsdom.')
    lines.push('')
    lines.push('| Fact | Value |')
    lines.push('| --- | --- |')
    lines.push(`| Source head | \`${head}\` |`)
    lines.push(`| Chromium | \`${chromiumVersion}\` (\`${CHROMIUM}\`) |`)
    lines.push(`| Node | \`${process.version}\` |`)
    lines.push(`| \`public/sdk.js\` sha256 | \`${sdkHash}\` |`)
    lines.push(`| \`public/sdk.min.js\` sha256 | \`${minHash}\` |`)
    lines.push('')
    lines.push('Command: `pnpm exec vitest run tests/browser-evidence.test.ts`')
    lines.push('')
    for (const e of evidence) {
      lines.push(`## ${e.title}`)
      lines.push('')
      lines.push('```json')
      lines.push(JSON.stringify(e.value, null, 2))
      lines.push('```')
      lines.push('')
    }
    writeFileSync(resolve(ROOT, 'docs/browser-evidence.md'), lines.join('\n'))
  }, 120_000)
})
