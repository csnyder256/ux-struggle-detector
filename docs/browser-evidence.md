# Browser evidence — runtime validation & SDK capture (PR #38)

Captured with **headless Chromium driving the built SDK bundle** — not jsdom.

| Fact | Value |
| --- | --- |
| Source (at capture) | `SDK bundles DIFFER from HEAD 5fb31597bb6f4356d2d9fe81d2f5f6c9e39a50a6; bundle inputs dirty at capture (public/sdk.js, public/sdk.min.js, src/sdk/index.ts); working tree DIRTY at capture (14 path(s) uncommitted, e.g. docs/browser-evidence.md, public/sdk.js, public/sdk.min.js, src/app/api/events/route.ts) - the capture uses the measured bundle bytes and records working-tree edits` |
| HEAD at capture | `5fb31597bb6f4356d2d9fe81d2f5f6c9e39a50a6` |
| SDK bundle bytes vs HEAD | **DIFFER** - the executed bundle is not the blob committed at `5fb31597bb6f4356d2d9fe81d2f5f6c9e39a50a6` |
| Bundle inputs at capture | **dirty** - uncommitted edits to `public/sdk.js`, `public/sdk.min.js`, `src/sdk/index.ts` |
| Working tree at capture | **DIRTY** - 14 uncommitted path(s): `docs/browser-evidence.md`, `public/sdk.js`, `public/sdk.min.js`, `src/app/api/events/route.ts`, `src/lib/interventions/dispatcher.ts`, `src/lib/struggle/detect.ts`, `src/lib/types/events.ts`, `src/sdk/index.ts`, `src/sdk/renderers.ts`, `tests/browser-evidence.test.ts`, `tests/dispatcher.test.ts`, `tests/sdk-renderers.test.ts`, `tests/sdk-validity-flow.test.ts`, `tests/struggle.test.ts`. This capture records the measured SDK bundle bytes above and uncommitted paths relative to `5fb31597bb6f4356d2d9fe81d2f5f6c9e39a50a6` |
| Chromium | `Chromium 154.0.8037.57 built on Debian GNU/Linux 12 (bookworm)` (`/usr/bin/chromium`) |
| Node | `v22.23.2` |
| `public/sdk.js` sha256 | `27e973f89e3b1387f91c4c0a4d8031c199ceb1f32f9866cfccd61e2ce7c97728` |
| `public/sdk.min.js` sha256 | `6dbd4139d426e14114ee24c7a06ee7f0c861401f7f36639090dbde9794af49a6` |

Command: `pnpm exec vitest run tests/browser-evidence.test.ts`

## 0. Source provenance at capture

```json
{
  "headAtCapture": "5fb31597bb6f4356d2d9fe81d2f5f6c9e39a50a6",
  "workingTreeDirtyAtCapture": true,
  "dirtyPathsAtCapture": [
    "docs/browser-evidence.md",
    "public/sdk.js",
    "public/sdk.min.js",
    "src/app/api/events/route.ts",
    "src/lib/interventions/dispatcher.ts",
    "src/lib/struggle/detect.ts",
    "src/lib/types/events.ts",
    "src/sdk/index.ts",
    "src/sdk/renderers.ts",
    "tests/browser-evidence.test.ts",
    "tests/dispatcher.test.ts",
    "tests/sdk-renderers.test.ts",
    "tests/sdk-validity-flow.test.ts",
    "tests/struggle.test.ts"
  ],
  "bundleSourceDirtyAtCapture": true,
  "bundleDirtyPathsAtCapture": [
    "public/sdk.js",
    "public/sdk.min.js",
    "src/sdk/index.ts"
  ],
  "sdkBundleMatchesHead": false,
  "sdkMinBundleMatchesHead": false,
  "bundleMatchesHead": false,
  "sourceLabel": "SDK bundles DIFFER from HEAD 5fb31597bb6f4356d2d9fe81d2f5f6c9e39a50a6; bundle inputs dirty at capture (public/sdk.js, public/sdk.min.js, src/sdk/index.ts); working tree DIRTY at capture (14 path(s) uncommitted, e.g. docs/browser-evidence.md, public/sdk.js, public/sdk.min.js, src/app/api/events/route.ts) - the capture uses the measured bundle bytes and records working-tree edits"
}
```

## 1. Real Chromium constraint API (no SDK)

```json
{
  "vatCustomMessage": {
    "valid": false,
    "message": "That is a card number, not a VAT ID.",
    "customError": true,
    "badInput": false,
    "rangeUnderflow": false,
    "stepMismatch": false,
    "valueMissing": false,
    "value": ""
  },
  "numericStep": {
    "valid": false,
    "message": "Please enter a valid value. The two nearest valid values are 1 and 6.",
    "customError": false,
    "badInput": false,
    "rangeUnderflow": false,
    "stepMismatch": true,
    "valueMissing": false,
    "value": "3"
  },
  "rangeUnderflow": {
    "valid": false,
    "message": "Value must be greater than or equal to 10.",
    "customError": false,
    "badInput": false,
    "rangeUnderflow": true,
    "stepMismatch": false,
    "valueMissing": false,
    "value": "3"
  }
}
```

## 1b. Real Chromium badInput state (not reproducible; see note)

```json
{
  "typed": "abc",
  "value": "",
  "valid": true,
  "badInput": false,
  "message": ""
}
```

## 2. Real SDK bundle: captured events

```json
{
  "emitted": 6,
  "withValidity": [
    {
      "schemaVersion": 3,
      "idempotencyKey": "sh_sess_1790622124619_4iztywwz_1790622124630_7og0am1q",
      "sessionId": "sh_sess_1790622124619_4iztywwz",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "FOCUS",
      "ts": "2026-09-28T19:02:04.630Z",
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 11
      },
      "element": {
        "touched": true,
        "dirty": false,
        "valueLength": 0,
        "validity": "customError",
        "validationMessage": "That is a card number, not a VAT ID.",
        "formId": "(unnamed-form)",
        "formValid": false
      }
    },
    {
      "schemaVersion": 3,
      "idempotencyKey": "sh_sess_1790622124619_4iztywwz_1790622124633_a0m906xe",
      "sessionId": "sh_sess_1790622124619_4iztywwz",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "CLICK",
      "ts": "2026-09-28T19:02:04.633Z",
      "meta": {},
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 14
      },
      "element": {
        "touched": true,
        "dirty": false,
        "valueLength": 0,
        "validity": "customError",
        "validationMessage": "That is a card number, not a VAT ID.",
        "formId": "(unnamed-form)",
        "formValid": false
      }
    },
    {
      "schemaVersion": 3,
      "idempotencyKey": "sh_sess_1790622124619_4iztywwz_1790622124634_36v59yqy",
      "sessionId": "sh_sess_1790622124619_4iztywwz",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "BLUR",
      "ts": "2026-09-28T19:02:04.634Z",
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 15
      },
      "element": {
        "touched": true,
        "dirty": false,
        "valueLength": 0,
        "validity": "customError",
        "validationMessage": "That is a card number, not a VAT ID.",
        "formId": "(unnamed-form)",
        "formValid": false
      }
    },
    {
      "schemaVersion": 3,
      "idempotencyKey": "sh_sess_1790622124619_4iztywwz_1790622124635_h2vj2c3u",
      "sessionId": "sh_sess_1790622124619_4iztywwz",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "FOCUS",
      "ts": "2026-09-28T19:02:04.635Z",
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 16
      },
      "element": {
        "touched": true,
        "dirty": false,
        "valueLength": 1,
        "validity": "stepMismatch",
        "formId": "(unnamed-form)",
        "formValid": false
      }
    },
    {
      "schemaVersion": 3,
      "idempotencyKey": "sh_sess_1790622124619_4iztywwz_1790622124635_rc7k0eu4",
      "sessionId": "sh_sess_1790622124619_4iztywwz",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "CLICK",
      "ts": "2026-09-28T19:02:04.635Z",
      "meta": {},
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 17
      },
      "element": {
        "touched": true,
        "dirty": false,
        "valueLength": 1,
        "validity": "stepMismatch",
        "formId": "(unnamed-form)",
        "formValid": false
      }
    }
  ],
  "eventTypes": [
    "NAVIGATION",
    "FOCUS",
    "CLICK",
    "BLUR",
    "FOCUS",
    "CLICK"
  ]
}
```

## 3. Browser-captured event -> real ingest schema -> real dispatcher

```json
{
  "schemaAccepted": true,
  "capturedValidity": "customError",
  "capturedMessage": "That is a card number, not a VAT ID.",
  "renderedCopy": "Tax ID That is a card number, not a VAT ID.",
  "copyCarriesBrowserMessage": true
}
```
