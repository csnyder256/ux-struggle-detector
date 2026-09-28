# Browser evidence — runtime validation & SDK capture (PR #38)

Captured with **headless Chromium driving the built SDK bundle** — not jsdom.

| Fact | Value |
| --- | --- |
| Source (at capture) | `SDK bundles are byte-identical to HEAD f892ef54d02febf60dc9b1c550be3450ee98faf5; bundle inputs clean at capture; working tree DIRTY at capture (2 path(s) uncommitted, e.g. tests/sdk-dwell-attribution.test.ts, vitest.config.ts) - the capture uses the measured bundle bytes and records working-tree edits` |
| HEAD at capture | `f892ef54d02febf60dc9b1c550be3450ee98faf5` |
| SDK bundle bytes vs HEAD | match - `public/sdk.js` and `public/sdk.min.js` are byte-identical to the blobs committed at `f892ef54d02febf60dc9b1c550be3450ee98faf5` (compared via `git show HEAD:<path>` sha256, not via `git status`) |
| Bundle inputs at capture | clean - `src/sdk/index.ts` and both bundles are unmodified in the working tree |
| Working tree at capture | **DIRTY** - 2 uncommitted path(s): `tests/sdk-dwell-attribution.test.ts`, `vitest.config.ts`. This capture records the measured SDK bundle bytes above and uncommitted paths relative to `f892ef54d02febf60dc9b1c550be3450ee98faf5` |
| Chromium | `Chromium 154.0.8037.57 built on Debian GNU/Linux 12 (bookworm)` (`/usr/bin/chromium`) |
| Node | `v22.23.2` |
| `public/sdk.js` sha256 | `27e973f89e3b1387f91c4c0a4d8031c199ceb1f32f9866cfccd61e2ce7c97728` |
| `public/sdk.min.js` sha256 | `6dbd4139d426e14114ee24c7a06ee7f0c861401f7f36639090dbde9794af49a6` |

Command: `pnpm exec vitest run tests/browser-evidence.test.ts`

## 0. Source provenance at capture

```json
{
  "headAtCapture": "f892ef54d02febf60dc9b1c550be3450ee98faf5",
  "workingTreeDirtyAtCapture": true,
  "dirtyPathsAtCapture": [
    "tests/sdk-dwell-attribution.test.ts",
    "vitest.config.ts"
  ],
  "bundleSourceDirtyAtCapture": false,
  "bundleDirtyPathsAtCapture": [],
  "sdkBundleMatchesHead": true,
  "sdkMinBundleMatchesHead": true,
  "bundleMatchesHead": true,
  "sourceLabel": "SDK bundles are byte-identical to HEAD f892ef54d02febf60dc9b1c550be3450ee98faf5; bundle inputs clean at capture; working tree DIRTY at capture (2 path(s) uncommitted, e.g. tests/sdk-dwell-attribution.test.ts, vitest.config.ts) - the capture uses the measured bundle bytes and records working-tree edits"
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
      "idempotencyKey": "sh_sess_1790623151347_dlevau8o_1790623151358_90y1j4he",
      "sessionId": "sh_sess_1790623151347_dlevau8o",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "FOCUS",
      "ts": "2026-09-28T19:19:11.358Z",
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
      "idempotencyKey": "sh_sess_1790623151347_dlevau8o_1790623151361_edvluo10",
      "sessionId": "sh_sess_1790623151347_dlevau8o",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "CLICK",
      "ts": "2026-09-28T19:19:11.361Z",
      "meta": {},
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
      "idempotencyKey": "sh_sess_1790623151347_dlevau8o_1790623151362_w1roq1bq",
      "sessionId": "sh_sess_1790623151347_dlevau8o",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "BLUR",
      "ts": "2026-09-28T19:19:11.362Z",
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
      "idempotencyKey": "sh_sess_1790623151347_dlevau8o_1790623151362_s3fr7c7y",
      "sessionId": "sh_sess_1790623151347_dlevau8o",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "FOCUS",
      "ts": "2026-09-28T19:19:11.362Z",
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
    },
    {
      "schemaVersion": 3,
      "idempotencyKey": "sh_sess_1790623151347_dlevau8o_1790623151363_96kdacrh",
      "sessionId": "sh_sess_1790623151347_dlevau8o",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "CLICK",
      "ts": "2026-09-28T19:19:11.363Z",
      "meta": {},
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 15
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
