# UX Struggle SDK

A small, framework-independent SDK for observing UI struggle, rendering targeted help and guiding users through complete tours. ESM, CommonJS and script builds include TypeScript declarations. No runtime dependencies.

## Install the released package

Download the versioned `.tgz` and `checksums.txt` from [v0.3.0](https://github.com/csnyder256/ux-struggle-detector/releases/tag/v0.3.0), verify its SHA-256, then:

```sh
npm install ./csnyder256-ux-struggle-sdk-0.3.0.tgz
```

This package is distributed on GitHub Releases. An npm registry publication requires the package owner's publishing identity; this documentation does not claim one exists.

## Integrate

```ts
import { initSelfHealing, destroySelfHealing, startTour } from '@csnyder256/ux-struggle-sdk'

initSelfHealing({ orgId: 'your_org', endpoint: 'https://your-app.example/api/events' })
// With REQUIRE_INGEST_KEY, supply the organization's public scoped ingest key.
// Keep provider credentials and administrative keys on the server.

const tour = startTour({ steps: [
  { title: 'Choose a plan', copy: 'Compare plans before continuing.', selector: '#plans' },
  { title: 'Review your choice', copy: 'Check the total before checkout.', selector: '#review' },
], onFinish: () => console.log('Tour completed') })

// In a framework effect's cleanup:
tour?.close()
destroySelfHealing()
```

Imports are inert and safe during SSR. Only `initSelfHealing()` starts collection. The script build retains automatic initialization from `data-org-id` attributes. Reinitialization after `destroySelfHealing()` is supported. Multiple simultaneous SDK instances are not supported.

For local use, set `endpoint: 'console'` and leave local overlays disabled unless needed. `flush()` waits for queued element hashes; `track(name, props)` adds a business event; `identify(id)` sends a SHA-256-derived pseudonymous ID. Hashing identifiers is pseudonymization, not anonymity. The local rage-click rule is a fast fallback; the server remains the production system of record.

Tours support Back, Next, Finish, Escape, focus trapping/restoration, missing targets and replay. Text is inserted as text. A dispatched `TOUR` may carry `options.steps` as a JSON string of the same step objects; outcomes use the persisted row ID. Completion is only reported on Finish.

## Collection and privacy

Input events carry scrubbed lengths rather than raw values. Events also include route, element/page context and supplied custom metadata. Do not put personal data in labels, routes, `track` properties or error messages. Scrubbing is pattern-based and cannot guarantee removal of all personal data. Integrate consent, retention, access controls and the organization's privacy policy before enabling production collection.

`onEvent` receives a detached copy of each buffered event; `onLocalStruggle` exposes local rule evidence. Callback failures cannot break collection. Destroy aborts in-flight requests, removes collectors and timers, restores history methods when still SDK-owned, and removes interventions. Runtime-generated `data-sh-id` attributes remain as targeting metadata; route or organization changes refresh SDK-owned IDs. It intentionally does not flush on destruction; call `await flush()` first when delivery is required.

Supported: current evergreen browsers with WebCrypto, AbortController and ES2020; script builds additionally expose `window.ClarusHeal`. MIT licensed. See the repository for the server, guided demo and deployment instructions.

## Run the guided demonstration

Open [the live lab](https://csnyder256.github.io/ux-struggle-detector/demo/). Create three rapid checkout clicks, inspect the actual production detector, enable clear feedback, try format guidance, finish the five-step tour, and export the JSON evidence. The lab runs entirely locally after loading, using the real collector, detector and renderers. It does not measure conversion lift or exercise production database persistence. Stop and reset controls demonstrate the collection lifecycle.

Build from source with `pnpm sdk:package` and `pnpm demo:build`. Validate the packed package with `pnpm sdk:verify`; run the real desktop/mobile journey with `pnpm demo:verify` after `pnpm exec playwright install chromium`.

## Optional npm registry publication

The released tarball is installable now. The `publish-sdk.yml` workflow is dormant until the package owner configures npm's trusted publisher for `csnyder256/ux-struggle-detector`, workflow `publish-sdk.yml`, environment `npm-publish`, and enables the repository variable `NPM_TRUSTED_PUBLISH_ENABLED=true`. Configure the initial package ownership through npm first. The workflow verifies the existing release's package SHA-256 and exact tagged source before publishing it with provenance. It uses Node 24 and npm 11 or newer, without a stored npm token. [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) describes the owner-side setup.
