# Browser evidence — runtime validation & SDK capture (PR #38)

Captured with **headless Chromium driving the built SDK bundle** — not jsdom.

| Fact | Value |
| --- | --- |
| Source (at capture) | `SDK bundles DIFFER from HEAD dbe4d514a1a53e8eba1615f6c60487d62bf5d6df; bundle inputs dirty at capture (public/sdk.js, public/sdk.min.js, src/sdk/index.ts); working tree DIRTY at capture (4 path(s) uncommitted, e.g. public/demo/demo.js, public/sdk.js, public/sdk.min.js, src/sdk/index.ts) - the capture uses the measured bundle bytes and records working-tree edits` |
| HEAD at capture | `dbe4d514a1a53e8eba1615f6c60487d62bf5d6df` |
| SDK bundle bytes vs HEAD | **DIFFER** - the executed bundle is not the blob committed at `dbe4d514a1a53e8eba1615f6c60487d62bf5d6df` |
| Bundle inputs at capture | **dirty** - uncommitted edits to `public/sdk.js`, `public/sdk.min.js`, `src/sdk/index.ts` |
| Working tree at capture | **DIRTY** - 4 uncommitted path(s): `public/demo/demo.js`, `public/sdk.js`, `public/sdk.min.js`, `src/sdk/index.ts`. This capture records the measured SDK bundle bytes above and uncommitted paths relative to `dbe4d514a1a53e8eba1615f6c60487d62bf5d6df` |
| Chromium | `Chromium 154.0.8037.57 built on Debian GNU/Linux 12 (bookworm)` (`/usr/bin/chromium`) |
| Node | `v22.23.2` |
| `public/sdk.js` sha256 | `f15680ceff8724ffe9d9b79bc629fe30e33f0758ac90fcaa527560cb86d9717c` |
| `public/sdk.min.js` sha256 | `837a2e384f2f1af6ee10bee021c23e40af09024b43c0317a1b303a14fc793c1e` |

Command: `pnpm exec vitest run tests/browser-evidence.test.ts`

## 0. Source provenance at capture

```json
{
  "headAtCapture": "dbe4d514a1a53e8eba1615f6c60487d62bf5d6df",
  "workingTreeDirtyAtCapture": true,
  "dirtyPathsAtCapture": [
    "public/demo/demo.js",
    "public/sdk.js",
    "public/sdk.min.js",
    "src/sdk/index.ts"
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
  "sourceLabel": "SDK bundles DIFFER from HEAD dbe4d514a1a53e8eba1615f6c60487d62bf5d6df; bundle inputs dirty at capture (public/sdk.js, public/sdk.min.js, src/sdk/index.ts); working tree DIRTY at capture (4 path(s) uncommitted, e.g. public/demo/demo.js, public/sdk.js, public/sdk.min.js, src/sdk/index.ts) - the capture uses the measured bundle bytes and records working-tree edits"
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
      "idempotencyKey": "sh_sess_1790663757473_iwx28r5h_1790663757481_p5fknjki",
      "sessionId": "sh_sess_1790663757473_iwx28r5h",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "FOCUS",
      "ts": "2026-09-29T06:35:57.481Z",
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 7
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
      "idempotencyKey": "sh_sess_1790663757473_iwx28r5h_1790663757483_axngrhr4",
      "sessionId": "sh_sess_1790663757473_iwx28r5h",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "CLICK",
      "ts": "2026-09-29T06:35:57.483Z",
      "meta": {},
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 10
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
      "idempotencyKey": "sh_sess_1790663757473_iwx28r5h_1790663757484_bv41all7",
      "sessionId": "sh_sess_1790663757473_iwx28r5h",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "BLUR",
      "ts": "2026-09-29T06:35:57.484Z",
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 10
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
      "idempotencyKey": "sh_sess_1790663757473_iwx28r5h_1790663757485_ro1dozh1",
      "sessionId": "sh_sess_1790663757473_iwx28r5h",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "FOCUS",
      "ts": "2026-09-29T06:35:57.485Z",
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 11
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
      "idempotencyKey": "sh_sess_1790663757473_iwx28r5h_1790663757485_3xwthyv6",
      "sessionId": "sh_sess_1790663757473_iwx28r5h",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "CLICK",
      "ts": "2026-09-29T06:35:57.485Z",
      "meta": {},
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 11
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
