# ux-struggle-detector

**Catch users getting stuck, then help them on the spot.**

![TypeScript](https://img.shields.io/badge/typescript-5.6%20strict-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/next.js-15%20app%20router-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![Prisma](https://img.shields.io/badge/prisma-5%20%2F%20postgres-2D3748?style=flat-square&logo=prisma&logoColor=white)
![Tests](https://img.shields.io/badge/tests-165%20across%2010%20files-brightgreen?style=flat-square)
![Detection rules](https://img.shields.io/badge/struggle%20rules-40-orange?style=flat-square)
![SDK](https://img.shields.io/badge/browser%20SDK-25%20KB%20minified-informational?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

Built under the product name **Clarus Heal**. It maps a customer's web app UI, either by reading their GitHub repo or by crawling their live site, then watches real users through a drop-in script tag. Struggle detection runs server-side against 40 named rules, and any intervention it decides to show comes back in the same HTTP response the events arrived in. The customer never edits their application code to add a hint. A PII scrubber runs in the browser before anything is sent.

Three pillars:

1. **Map the UI first.** Framework detection across 46 registry entries in 22 families, a Babel AST parser for React and Preact, a universal template scanner for everything else, plus an LLM pass that gives each element a semantic name and intent.
2. **Watch from the browser.** A dependency-free SDK (about 1,640 lines, 25 KB minified) capturing 15 event types with client-side PII masking, offline buffering, and sampling.
3. **Decide and intervene server-side.** 40 detection rules over hydrated session history, then a bandit-driven dispatcher that returns an overlay, tooltip, or hint inline.

---

## The problem

A user opens a billing settings page, clicks the same disabled button four times, retypes a tax ID three times, hits the browser back button twice, and leaves. Nobody finds out. The session-replay tool recorded it, but somebody has to watch the replay, and nobody does. The analytics dashboard shows a funnel drop from 71% to 64%, which tells you a number changed but not what a person was trying to do.

The gap is between knowing something is wrong and doing something about it while the user is still on the page. Analytics and replay tools observe and report. Product tour tools intervene, but only where a human already decided in advance that a tour should appear, and only after somebody built it.

## What makes it hard

Three constraints shaped the design, and most of the interesting code exists because of them.

**1. The system has to know what the UI is, before anyone uses it.** "The user rage-clicked element `sh_9f3c...`" is useless. "The user rage-clicked the Save Tax Settings button on `/settings/billing`" is actionable. So the platform ingests the customer's frontend first and builds a `UIMap` of every interactive element and route.

**2. Struggle spans HTTP requests.** Rage clicks fit in one event batch. Circular navigation, back-button thrash, and dead ends do not: the loop plays out over 30 seconds and three POSTs. A detector that only sees the incoming batch will never fire those rules and will still look like it works, because the rules that do fit in a batch keep firing. The ingest route therefore hydrates recent stored history for every session in the batch before running detection.

**3. Getting it wrong is worse than doing nothing.** An overlay that appears on a checkout page for a user who was not confused is a bug the customer sees before you do. So safe mode is on by default, invasive intervention types are allowlist-gated, sensitive routes have a denylist, and detection thresholds adapt per element instead of using one global constant.

## How it works

```mermaid
flowchart TD
  A[customer repo or live URL] --> B[framework detector<br/>46 entries, 22 families]
  B --> C[Babel AST parser<br/>or universal template scan]
  C --> D[UIElement / UIRoute rows]
  D --> E[LLM enrichment<br/>semantic name, intent, help copy]
  F[real user's browser<br/>SDK: 15 event types, PII scrub,<br/>offline buffer, sampling] --> G[POST /api/events]
  G --> H[persist idempotently]
  H --> I[hydrate recent session history]
  I --> J[load per-element baselines]
  E --> J
  J --> K[40-rule detector]
  K --> L[dispatcher: bandit, cache,<br/>denylist, safe mode]
  L --> M[interventions in the SAME response]
  M --> N[SDK renders overlay / tooltip / hint]
  N --> O[outcome events: shown, dismissed, success]
  O --> L
```

### Pillar 1: mapping the customer's UI

`src/lib/parsers/` turns a frontend into a structured map.

- **Framework detection** (`registry.ts`, `detector.ts`) scores a repo against 46 registry entries across 22 families using four independent signals: `package.json` dependencies, config file presence, file extensions under `src/`, and npm script contents. It reports a confidence score and is deliberately biased toward under-reporting, because a wrong framework guess cascades into wrong parsing, and an honest "I don't know" is recoverable while confidently bad output is not.
- **React, Next, Remix and Preact** go through a Babel AST parser (`react.ts`, 797 lines) that walks JSX, resolves handler functions, and extracts validation attributes.
- **Everything else** (Vue, Svelte, Angular, Astro, Solid, Qwik, Lit, Alpine, HTMX and the rest) routes to a universal template scanner (`universal-html.ts`, 703 lines) with per-family route detection. This is a deliberate accuracy tradeoff, documented in `parsers/index.ts`: every framework gets a working extraction path on day one.
- **GitHub ingestion** goes entirely through the Octokit tree and blob API. No `git clone`, no shell-out, no filesystem dependency, which is what makes the mapper deployable to a serverless host.
- **Live sites** can be crawled instead, either with a plain HTML fetcher (`crawler.ts`) or a Playwright-driven crawler for SPAs (`playwright-crawler.ts`).

Every extracted element gets a deterministic ID (`sh_` plus 32 hex chars) from `hashElementId()` in `src/lib/types/ui-map.ts`, hashed over `(orgId, filePath, nodeDescriptor)` with the global Web Crypto API. That choice is load-bearing: the identical function runs unmodified in Node build tooling, in edge runtimes, and in the customer's browser. The file documents the invariant explicitly, because any drift between those three consumers degrades the system silently rather than failing loudly.

### Pillar 2: the browser SDK

`src/sdk/` is eight files, roughly 1,640 lines, zero runtime dependencies, bundled by esbuild into an IIFE at `public/sdk.min.js` (25,282 bytes; the unminified `sdk.js` is 33,231).

```html
<script src="https://your-deployment/sdk.min.js"></script>
<script>
  ClarusHeal.initSelfHealing({
    orgId: 'org_...',
    endpoint: 'https://your-deployment/api/events',
    ingestKey: 'ck_...',
  })
</script>
```

There is also a one-line auto-init form: a `<script>` tag carrying `data-org-id` is picked up by `readAutoInitOptions()` (`src/sdk/index.ts:547`), so no second script block is needed.

It captures 15 event types (click, input change, submit, navigation, hover, scroll, dwell, paste, copy, focus, blur, keydown, JS error, validation error, custom), buffers to survive offline, and supports uniform, per-type, and predicate-based sampling.

Honest wrinkle: **the SDK emits 15 event types; the Prisma `EventType` enum persists 7.** The extra types are collapsed at the persistence boundary today.

**The PII scrubber runs before anything leaves the page.** `src/sdk/scrubber.ts` holds 15 regex patterns in `DEFAULT_PATTERNS`, masking emails, credit-card-shaped digit runs, US SSNs, US and international phone numbers, IBANs, IPv4 and IPv6 addresses, JWTs, AWS access key IDs, GitHub tokens, Stripe keys, and Anthropic/OpenAI-shaped keys, with customer-supplied extra patterns merged in. The masking happens client-side by design: a scrubber that runs on the server has already lost.

12 of the 15 `InterventionType` values have an SDK renderer. `DOM`, `BEHAVIOR` and `AUTO_FIX` have none, by design. `TOUR` is a stub: it renders as a modal, because multi-step `TourConfig` steps are not populated by the dispatcher yet (`src/sdk/renderers.ts:553`).

### Pillar 3: detection and intervention

`src/app/api/events/route.ts` (714 lines) is the hot path. Per batch it authenticates the org against a hashed ingest key, Zod-validates against a versioned wire schema (`EVENT_SCHEMA_VERSION` is 3 and versions 1 and 2 are still accepted, so old cached SDK bundles in customers' browsers keep working through a rollout), persists, hydrates up to 1,000 stored events from a 5-minute lookback for the sessions in the batch, loads per-element baselines, runs the detector, records outcomes from prior impressions, and dispatches interventions inline.

**Idempotent ingest by construction.** A `(orgId, idempotencyKey)` unique index plus `createMany({ skipDuplicates: true })` means the SDK offline replay buffer can retry as aggressively as it likes with zero server-side dedup logic.

`src/lib/struggle/detect.ts` (1,182 lines) is 40 named rules, each an independently testable pure function over `RuntimeEvent[]`. The literal `StruggleType` members:

| Family | Members |
| --- | --- |
| Click (4) | `RAGE_CLICK`, `DEAD_CLICK`, `INVALID_CLICK`, `MIS_CLICK` |
| Form (9) | `THRASH`, `BACKTRACK`, `VALIDATION_LOOP`, `ABANDONED_FIELD`, `PASTE_REPEAT`, `REQUIRED_MISSED`, `FORMAT_ERROR`, `PASSWORD_RETRY`, `SLOW_FILL` |
| Navigation (6) | `LOOP`, `SILENT_FAIL`, `BACK_THRASH`, `DEAD_END`, `QUICK_BOUNCE`, `CIRCULAR_NAV` |
| Discovery (9) | `HOVER_HUNT`, `LONG_DWELL`, `RAPID_SCROLL`, `SCROLL_OVERSHOOT`, `IDLE_AFTER_LOAD`, `EMPTY_SEARCH`, `REPEAT_SEARCH`, `ZERO_RESULTS`, `FAILED_FILTER` |
| UI confusion (3) | `MENU_THRASH`, `TOOLTIP_HOVER_REPEAT`, `TAB_HOPPING` |
| Error (4) | `ERROR_DISMISS`, `RETRY_LOOP`, `NOT_FOUND_BOUNCE`, `JS_ERROR` |
| Auth (2) | `LOGIN_FAILURE`, `LOCKED_OUT` |
| Other (3) | `KEYBOARD_LOST_FOCUS`, `COPY_BOUNCE`, `HELP_HUNT` |

Detection thresholds are not constants. A nightly cron computes p95 click-rate, dwell, and hover baselines per element, and the detector consumes them, so a noisy game button gets a higher rage-click threshold than a Delete button.

`src/lib/interventions/dispatcher.ts` (523 lines) picks what to show. It runs an epsilon-greedy multi-armed bandit (epsilon 0.1) over copy variants, weighted by empirical success rate with Laplace smoothing. `pickVariantDeterministic` takes over in two cases: below `banditMinSamples` (30) total impressions, and whenever the stats map is absent entirely. That guarantees both early exploration and reproducible unit tests. The RNG is injectable. The dispatcher honors a per-route denylist and per-intervention pause flags, and prefers LLM-precomputed copy from an `InterventionCache` over the 42 in-code templates in `library.ts`, but only for the eight allowlisted renderer types in `VALID_RENDERER_TYPES` (`OVERLAY`, `HIGHLIGHT`, `TOOLTIP`, `MODAL`, `BANNER`, `INLINE_HINT`, `CONFIRM`, `ANNOUNCE`). Invasive types are never served from cache and are permanently allowlist-gated.

The loop closes: the SDK reports shown, dismissed, and success back as `CUSTOM` events carrying the intervention row ID, which increments counters, recomputes `successRate`, writes a per-session impression row, and feeds the bandit's next pick.

## Other things worth a look

- **Safe mode is time-boxed, not an indefinite flag.** The schema carries both `safeMode Boolean @default(true)` and a `safeModeUntil DateTime?`; the dispatcher documents it as the default for the first 7 days post-install.
- **Two independent security flags.** `REQUIRE_AUTH` controls dashboard sign-in; `REQUIRE_INGEST_KEY` separately controls whether `/api/events` rejects batches with no `ck_` key. Ingest keys are stored as SHA-256 hashes plus an 8-character display prefix, and the plaintext token is shown once and unrecoverable afterward. Customer LLM keys are encrypted at rest with AES-256-GCM, a fresh 12-byte IV per record, and the auth tag appended to the ciphertext; tamper detection is covered by tests.
- **Providers are concrete and readable.** Every `(orgId, kind)` where kind is `DEEP` or `FAST` resolves to an independent `ModelProvider`, so rate-limit pools and usage counters stay separate. Defaults are hardcoded: `claude-opus-4-7` and `claude-haiku-4-5-20251001` for Anthropic, `gpt-4o` and `gpt-4o-mini` for OpenAI.
- **Degradation is systematic.** Baseline loads, cache reads, struggle persistence, intervention upserts, and usage metering are each individually caught, so a partial database failure still returns a valid intervention payload. Enrichment is cached on `(elementId, contextHash)` rather than `elementId` alone, so an element is re-enriched when its siblings, route, or parent component change.

## Key modules

| Path | Lines | What it is |
| --- | --- | --- |
| `src/lib/struggle/detect.ts` | 1,182 | the 40 detection rules |
| `src/lib/parsers/react.ts` | 797 | Babel JSX extraction |
| `src/app/api/events/route.ts` | 714 | ingest, hydrate, detect, dispatch |
| `src/lib/parsers/universal-html.ts` | 703 | template scan for non-React families |
| `prisma/schema.prisma` | 666 | 23 models, 10 enums |
| `src/sdk/index.ts` | 651 | SDK capture loop and init |
| `src/sdk/renderers.ts` | 640 | 12 intervention renderers |
| `src/lib/parsers/registry.ts` | 609 | 46 framework entries, 22 families |
| `src/lib/interventions/dispatcher.ts` | 523 | variant selection and gating |

## Quickstart

Requires Node 20 or newer (CI runs 22) and Postgres. `package.json` has no `engines` field; the floor is enforced by the setup script.

```bash
# Installs pnpm if missing, installs dependencies, writes .env from
# .env.example with generated secrets, and builds the SDK bundle.
./scripts/setup.sh            # macOS / Linux
.\scripts\setup.ps1           # Windows

docker compose up -d          # Postgres + Adminer on :8080, skip if you have your own

# The one value you must set by hand in .env:
#   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/clarus_heal?schema=public"

pnpm db:migrate
pnpm dev                      # http://localhost:3000
```

Open-access mode is the default (`REQUIRE_AUTH="false"`, `REQUIRE_INGEST_KEY="false"`): no sign-in, everything runs against an auto-provisioned "Demo Workspace" org. The Settings page has a demo-seed action that fills the dashboard with synthetic data. `public/demo/index.html` is a standalone SDK harness that runs in console mode with no server, no database, and no org, which is the fastest way to watch detection fire.

For a step-by-step walkthrough written for someone who has never set up a JavaScript project, see [GETTING_STARTED.md](GETTING_STARTED.md). Registering the GitHub App (only needed for the repo-ingest path) is covered in [GITHUB_SETUP.md](GITHUB_SETUP.md).

| Command | Does |
| --- | --- |
| `pnpm test` | Vitest |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint via `next lint` |
| `pnpm db:studio` | Prisma Studio on :5555 |
| `pnpm sdk:build` / `pnpm sdk:build:min` | esbuild the browser SDK into `public/` |
| `pnpm build` then `pnpm start` | Production build |

Deployment target is Vercel. `vercel.json` declares three cron workers: `detect-struggles` every 5 minutes, `compute-baselines` daily at 04:00 UTC, `precompute-interventions` hourly. All three are gated behind `CRON_SECRET`.

**Dependency caveats worth knowing before you install.** `playwright` is a full runtime dependency, not a devDependency, because the SPA crawler needs it; on a serverless target that is real weight. `react` and `react-dom` are pinned to `19.0.0-rc.*` and `next-auth` to `5.0.0-beta.25`, so two prerelease pins sit in the critical path.

## Project layout

```
src/
  app/                 Next.js App Router
    (marketing)/       landing page
    onboarding/        three ingest paths: github / crawler / direct BYO-keys wizard
    dashboard/         11 pages: overview, install, repos, flows, friction, elements,
                       elements/[id], interventions, sessions, usage, settings
    api/               events (hot path), auth, github, health, cron/*
  lib/
    types/             single sources of truth: ui-map.ts, events.ts, interventions.ts
    parsers/           registry -> detector -> dispatcher -> react | universal-html
                       | crawler | playwright-crawler, plus persist.ts
    struggle/          detect.ts (40 rules), baselines.ts (per-element p95 stats)
    interventions/     library.ts (42 templates), dispatcher.ts, precompute.ts
    enrichment/        LLM passes over elements and routes
    providers/         ModelProvider interface + anthropic / openai
    crypto/ auth/ usage/ github/ db/ access.ts
  sdk/                 dependency-free browser SDK (8 files, ~1,640 LOC)
  components/          hand-written shadcn-style primitives (no Radix dependency)
prisma/                schema.prisma, 4 applied migrations
tests/                 10 Vitest files, 165 tests
scripts/               setup.sh, setup.ps1
public/                sdk.js, sdk.min.js (checked-in esbuild output), demo/
```

20,492 lines of TypeScript and TSX across 115 files in `src/` and `tests/`. Dashboard reads go through server components and mutations through inline server actions; there is deliberately no REST layer for the dashboard, only for SDK ingest and webhooks.

The four migration directory names read as the project's phase history: `init`, `expand_enums`, `platform_config_allowlists`, `phase_25_events_and_sampling`.

`pnpm-workspace.yaml` exists at the root but contains only a build flag (`allowBuilds: esbuild: false`). There are no workspace packages. This is one Next.js application, deliberately, not a half-finished monorepo.

## Testing

165 tests across 10 Vitest files.

| File | Tests | Covers |
| --- | --- | --- |
| `dispatcher.test.ts` | 40 | variant selection, bandit behavior, copy substitution |
| `struggle.test.ts` | 33 | detection rules |
| `sdk.test.ts` | 31 | PII scrubbing, buffering, sampling |
| `react-parser.test.ts` | 12 | Babel JSX extraction |
| `crawler.test.ts` | 11 | HTML crawl |
| `ui-map.test.ts` | 11 | ElementId determinism |
| `universal-parser.test.ts` | 10 | template scan across families |
| `playwright-crawler.test.ts` | 6 | SPA crawl |
| `crypto.test.ts` | 6 | AES-GCM round trip and tamper detection |
| `dispatcher-denylist.test.ts` | 5 | route denylist |

Coverage is concentrated on the pure, high-risk core: detection rules, dispatcher selection, both parser families, the crypto boundary, and the ElementId hash contract. Those are the components where a silent regression would degrade the product invisibly instead of breaking loudly.

**What is not covered:** there is no integration test that exercises `/api/events` end to end against a real database, there are no browser or E2E tests (Playwright is a crawling dependency here, not a test runner), and the dashboard's React pages are untested.

CI (`.github/workflows/ci.yml`) runs on push to main and on every PR: Node 22 and pnpm 10 with a cached store, then `prisma generate`, `typecheck`, `lint`, `test`, `sdk:build:min`. CI does not run `pnpm build`, and there is no Postgres service container, which is consistent with the suite being unit-level only.

## Status

| Area | Status | Notes |
| --- | --- | --- |
| GitHub repo ingestion, URL crawl, Playwright SPA crawl | Built | Octokit tree/blob API, no `git clone` |
| Framework detection | Built | 46 entries, 22 families, confidence-scored |
| React / Preact AST parsing | Built | `react.ts` |
| All other framework parsing | Partial | regex template scanner, finds elements and labels, less accurate than AST |
| `StubParser` / `SoftStubParser` | Unreachable | present in `parsers/stub.ts` as the escape hatch, but `parsers/index.ts` routes every family to either the React parser or the universal one, so nothing imports them |
| Browser SDK capture | Built | 15 event types, PII scrub, offline buffer, sampling |
| SDK renderers | Partial | 12 of 15 `InterventionType` values; `TOUR` renders as a modal |
| `DOM` / `BEHAVIOR` / `AUTO_FIX` interventions | Not built | in the schema and gated in the dispatcher; no SDK renderer exists, nothing rewrites a customer's DOM |
| 40 server-side detection rules | Built | with per-element adaptive baselines |
| Bandit dispatch, denylist, pause flags, safe mode | Built | `dispatcher.ts` |
| LLM enrichment and intervention precompute | Built | behind a provider abstraction |
| SaaS shell | Built | magic-link auth, onboarding wizard, 11 dashboard pages, usage metering, encrypted key storage |
| Scheduled workers | Built | three Vercel crons behind `CRON_SECRET` |
| Event type persistence | Partial | SDK emits 15 types, the `EventType` enum stores 7 |
| Integration / E2E tests | Not built | unit tests only |
| Monorepo split | Not planned | single app; workspace file exists only for a build flag |

## About this public copy

This repository is a sanitized copy of a private working tree. The `.env` file, which held live working credentials (SMTP password, GitHub App client and webhook secrets, the AES-GCM master key, the Auth.js session secret, the cron secret, and a personal tunnel hostname), was excluded. `.env.example` is the complete, all-blank template and is what you should copy. Machine-local build state (`node_modules/`, `.next/`, `tsconfig.tsbuildinfo`, `next-env.d.ts`) and an internal agent session journal containing local absolute paths were also removed. Nothing removed affects your ability to run the project.

`public/sdk.js` and `public/sdk.min.js` are checked-in esbuild output of this repo's own `src/sdk/` sources, kept deliberately so `public/demo/index.html` works out of the box; regenerate them with `pnpm sdk:build:min`.

The UI primitives in `src/components/ui/` were hand-written in the shadcn/ui style rather than pulled from its CLI. shadcn/ui is MIT and explicitly meant to be copied into your codebase; the attribution is noted here regardless.

`package.json` is `private: true` with no `exports` field, so the SDK cannot be installed from a registry. Use the script tag.

**This has never been deployed publicly. No customers, no traffic, no revenue.** Every number in this README comes from the code and the test suite.

## License

MIT. See [LICENSE](LICENSE).

---

Built by Cade (https://github.com/csnyder256). Repository: https://github.com/csnyder256/ux-struggle-detector
