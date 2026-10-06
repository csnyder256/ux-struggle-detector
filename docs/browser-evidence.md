# Browser evidence — runtime validation & SDK capture (PR #38)

Captured with **headless Chromium driving the built SDK bundle** — not jsdom.

| Fact | Value |
| --- | --- |
| Source (at capture) | `SDK bundles DIFFER from HEAD e3f0d477895f1c9e2a354bc670fe94d0b6180291; bundle inputs dirty at capture (public/sdk.js, public/sdk.min.js); working tree DIRTY at capture (6 path(s) uncommitted, e.g. docs/browser-evidence.md, public/demo/demo.js, public/sdk.js, public/sdk.min.js) - the capture uses the measured bundle bytes and records working-tree edits` |
| HEAD at capture | `e3f0d477895f1c9e2a354bc670fe94d0b6180291` |
| SDK bundle bytes vs HEAD | **DIFFER** - the executed bundle is not the blob committed at `e3f0d477895f1c9e2a354bc670fe94d0b6180291` |
| Bundle inputs at capture | **dirty** - uncommitted edits to `public/sdk.js`, `public/sdk.min.js` |
| Working tree at capture | **DIRTY** - 6 uncommitted path(s): `docs/browser-evidence.md`, `public/demo/demo.js`, `public/sdk.js`, `public/sdk.min.js`, `src/sdk/renderers.ts`, `tests/sdk-renderers.test.ts`. This capture records the measured SDK bundle bytes above and uncommitted paths relative to `e3f0d477895f1c9e2a354bc670fe94d0b6180291` |
| Chromium | `Chromium 154.0.8037.92 built on Debian GNU/Linux 12 (bookworm)` (`/usr/bin/chromium`) |
| Node | `v22.23.2` |
| `public/sdk.js` sha256 | `d8851e8fe4b8c518e0084f8eb0d1af2e94a3294261262e42f52be0179be35ce7` |
| `public/sdk.min.js` sha256 | `b846ce8621fb1754b4926f20bbae9a37d775994817eeae14423c365d6e62fc12` |

Command: `pnpm exec vitest run tests/browser-evidence.test.ts`

## 0. Source provenance at capture

```json
{
  "headAtCapture": "e3f0d477895f1c9e2a354bc670fe94d0b6180291",
  "workingTreeDirtyAtCapture": true,
  "dirtyPathsAtCapture": [
    "docs/browser-evidence.md",
    "public/demo/demo.js",
    "public/sdk.js",
    "public/sdk.min.js",
    "src/sdk/renderers.ts",
    "tests/sdk-renderers.test.ts"
  ],
  "bundleSourceDirtyAtCapture": true,
  "bundleDirtyPathsAtCapture": [
    "public/sdk.js",
    "public/sdk.min.js"
  ],
  "sdkBundleMatchesHead": false,
  "sdkMinBundleMatchesHead": false,
  "bundleMatchesHead": false,
  "sourceLabel": "SDK bundles DIFFER from HEAD e3f0d477895f1c9e2a354bc670fe94d0b6180291; bundle inputs dirty at capture (public/sdk.js, public/sdk.min.js); working tree DIRTY at capture (6 path(s) uncommitted, e.g. docs/browser-evidence.md, public/demo/demo.js, public/sdk.js, public/sdk.min.js) - the capture uses the measured bundle bytes and records working-tree edits"
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
      "idempotencyKey": "sh_sess_1791323458714_etx542w9_1791323458724_s4vhsol3",
      "sessionId": "sh_sess_1791323458714_etx542w9",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "FOCUS",
      "ts": "2026-10-06T21:50:58.724Z",
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 9
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
      "idempotencyKey": "sh_sess_1791323458714_etx542w9_1791323458727_6okvhpwt",
      "sessionId": "sh_sess_1791323458714_etx542w9",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "CLICK",
      "ts": "2026-10-06T21:50:58.727Z",
      "meta": {},
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 12
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
      "idempotencyKey": "sh_sess_1791323458714_etx542w9_1791323458728_5wd888cz",
      "sessionId": "sh_sess_1791323458714_etx542w9",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "BLUR",
      "ts": "2026-10-06T21:50:58.728Z",
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 13
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
      "idempotencyKey": "sh_sess_1791323458714_etx542w9_1791323458728_r2l3a6a9",
      "sessionId": "sh_sess_1791323458714_etx542w9",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "FOCUS",
      "ts": "2026-10-06T21:50:58.728Z",
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 13
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
      "idempotencyKey": "sh_sess_1791323458714_etx542w9_1791323458729_2905kuqe",
      "sessionId": "sh_sess_1791323458714_etx542w9",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "CLICK",
      "ts": "2026-10-06T21:50:58.729Z",
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
