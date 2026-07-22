/**
 * GitHub App webhook handler. Verifies signatures, dispatches push events
 * to the re-mapping queue (queue impl is Phase 18 of the plan; for now we
 * just acknowledge).
 *
 * Required headers from GitHub:
 *   - x-github-event
 *   - x-github-delivery
 *   - x-hub-signature-256 (HMAC-SHA256 of the body using the webhook secret)
 */

import { NextResponse, type NextRequest } from 'next/server'
import { Webhooks } from '@octokit/webhooks'
import { getGitHubAppConfig } from '@/lib/github/app'

export async function POST(request: NextRequest) {
  const cfg = getGitHubAppConfig()
  if (!cfg) {
    return NextResponse.json(
      { error: 'GitHub App not configured.' },
      { status: 503 },
    )
  }

  const signature = request.headers.get('x-hub-signature-256')
  const event = request.headers.get('x-github-event')
  const id = request.headers.get('x-github-delivery')
  if (!signature || !event || !id) {
    return NextResponse.json({ error: 'Missing required headers.' }, { status: 400 })
  }

  const body = await request.text()
  const webhooks = new Webhooks({ secret: cfg.webhookSecret })

  let verified = false
  try {
    verified = await webhooks.verify(body, signature)
  } catch {
    verified = false
  }
  if (!verified) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 })
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────
  // For now: log the event and acknowledge. The mapping worker will consume
  // these in a later phase via a queue (`installation`, `installation_repositories`,
  // `push` events trigger re-mapping for the affected repo).
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.log(`[github webhook] event=${event} delivery=${id}`)
  }

  return NextResponse.json({ ok: true, event, delivery: id })
}
