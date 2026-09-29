import { initSelfHealing, destroySelfHealing, flush, startTour, renderIntervention } from '../sdk'
import { detectStruggles } from '../lib/struggle/detect'
import { DEFAULT_STRUGGLE_RULES, type RuntimeEvent, type StruggleDetection } from '../lib/types/events'
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
let events: RuntimeEvent[] = []
let detections: StruggleDetection[] = []
let cycle = 0
let working = false
let detectedRage = false
let detectedValidation = false
let stopped = false
const rules = DEFAULT_STRUGGLE_RULES.rageClick
$('threshold').textContent = rules.minClicks + ' clicks · ' + (rules.windowMs / 1000) + ' seconds'
function draw(): void {
  const clicks = events.filter(e => e.eventType === 'CLICK' && e.element?.label === 'Place demo order')
  $('click-count').textContent = String(clicks.length)
  $('signal-count').textContent = String(detections.length)
  $('outcome-count').textContent = String(events.filter(e => e.meta?.kind === 'intervention_success').length)
  $('event-list').replaceChildren()
  for (const e of events.slice(-12).reverse()) {
    const item = document.createElement('li')
    const type = document.createElement('strong'); type.textContent = e.eventType
    const label = document.createElement('span'); label.textContent = e.element?.label || String(e.meta?.kind || e.meta?.trigger || 'Page activity')
    const time = document.createElement('time'); time.textContent = new Date(e.ts).toLocaleTimeString()
    item.append(type, label, time); $('event-list').append(item)
  }
}
function accepted(event: RuntimeEvent): void {
  // Ignore the evidence panel, navigation controls and tour chrome in this exercise.
  if (event.elementId && ![document.getElementById('place-order')?.getAttribute('data-sh-id'), document.getElementById('email')?.getAttribute('data-sh-id'), document.getElementById('validate')?.getAttribute('data-sh-id')].includes(event.elementId)) return
  events.push(event); events = events.slice(-250)
  detections = detectStruggles(events)
  const rage = detections.find(d => d.type === 'RAGE_CLICK')
  const validation = detections.find(d => d.type === 'FORMAT_ERROR')
  if (rage && !detectedRage) {
    detectedRage = true
    $('verdict').textContent = 'Rage click detected'
    $('explanation').textContent = rage.summary || 'The same control was clicked repeatedly within the rule window.'
    $('signal').dataset.state = 'detected'
    renderIntervention({ id: 'rage_' + cycle, rowId: 'demo_rage_' + cycle, type: 'TOOLTIP', targetElementId: rage.elementId, copy: 'Your order has not been placed. In this sandbox, apply clear feedback, then try the control once.', autoDismissMs: 12000 })
  }
  if (validation && !detectedValidation) {
    detectedValidation = true
    renderIntervention({ id: 'format_' + cycle, rowId: 'demo_format_' + cycle, type: 'INLINE_HINT', targetElementId: validation.elementId, copy: 'Use an email-shaped example such as demo@example.test.', autoDismissMs: 12000 })
    $('validation-result').textContent = 'Format error detected · targeted inline help rendered'
  }
  draw()
}
function boot(): void {
  stopped = false
  initSelfHealing({ orgId: 'portfolio_demo', endpoint: 'console', flushIntervalMs: 60000, enableLocalDemoOverlays: false, onEvent: accepted, onLocalStruggle: () => { $('local-rule').textContent = 'Local SDK rule agreed with the detector' } })
}
function reset(): void {
  destroySelfHealing(); cycle++; events = []; detections = []; working = false; detectedRage = false; detectedValidation = false
  $('verdict').textContent = 'Waiting for evidence'; $('signal').dataset.state = 'waiting'
  $('explanation').textContent = 'Click the demo control three times quickly. The real SDK records the events; the production detector runs locally against those events.'
  $('order-status').textContent = 'Intentionally missing feedback'; $('local-rule').textContent = 'Local SDK rule has not fired'
  $<HTMLInputElement>('email').value = ''
  $('tour-result').textContent = 'Five steps · replay any time'
  $('validation-result').textContent = 'Try an invalid email to reveal targeted help.'
  $('state').textContent = 'Collection active · local only'; $('pause').textContent = 'Stop collection'
  boot(); draw()
}
$('place-order').addEventListener('click', () => {
  if (working) $('order-status').textContent = 'Demo order confirmed. Nothing was purchased.'
})
$('repair').addEventListener('click', () => { working = true; $('order-status').textContent = 'Clear feedback enabled. Click Place demo order once.' })
$('reset').addEventListener('click', reset)
$('pause').addEventListener('click', () => {
  if (stopped) { boot(); $('state').textContent = 'Collection active · local only'; $('pause').textContent = 'Stop collection' }
  else { destroySelfHealing(); stopped = true; $('state').textContent = 'Collection stopped'; $('pause').textContent = 'Resume collection' }
})
$('validation-form').addEventListener('submit', e => {
  e.preventDefault()
  const input = $<HTMLInputElement>('email')
  if (!input.value.includes('@') || !input.value.split('@')[1]?.includes('.')) {
    document.dispatchEvent(new CustomEvent('clarus-heal:validation', { detail: { kind: 'format', field: 'email', element: input } }))
    $('validation-result').textContent = 'Validation event captured'
  } else $('validation-result').textContent = 'Example accepted. No address was submitted.'
})
$('tour').addEventListener('click', () => startTour({ steps: [
  { title: 'Create a visible struggle', copy: 'The checkout control deliberately gives no feedback. Click it three times within two seconds to create real evidence.', selector: '#sandbox' },
  { title: 'Inspect the rule', copy: 'The same detector used by the backend evaluates the captured events here in your browser. No server, database or model call is involved.', selector: '#signal' },
  { title: 'Follow the intervention', copy: 'A targeted tooltip explains what happened. Enable clear feedback, click the order control once and inspect the outcome event.', selector: '#repair' },
  { title: 'Try field guidance', copy: 'Enter an invalid example and submit. A validation event produces targeted inline help without capturing the input value.', selector: '#validation-form' },
  { title: 'Keep the evidence', copy: 'Export the events, detector output and rules as JSON. This is a controlled demonstration, not a conversion-rate experiment.', selector: '#export' },
], onFinish: () => { $('tour-result').textContent = 'Tour complete · replay any time' } }))
$('export').addEventListener('click', async () => {
  await flush()
  const record = { schema_version: 1, product_version: '0.3.0', mode: 'controlled_local_demo', server_detector_executed_locally: true, rules: { rageClick: rules }, events, detections, limitations: ['No production conversion or causal lift is measured.', 'Local demo does not exercise database persistence or model enrichment.'] }
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'ux-struggle-demo.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
})
window.addEventListener('pagehide', () => destroySelfHealing())
reset()
