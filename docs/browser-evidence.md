# Browser evidence — runtime validation & SDK capture (PR #38)

Captured with **headless Chromium driving the built SDK bundle** — not jsdom.

| Fact | Value |
| --- | --- |
| Source (at capture) | `SDK bundles are byte-identical to HEAD a5f3abd6b2b96479d964f658e231def4e0bf1441; bundle inputs clean at capture; working tree DIRTY at capture (3 path(s) uncommitted, e.g. src/lib/struggle/baselines.ts, tests/baselines-dwell-grouping.test.ts, tests/browser-evidence.test.ts) - the capture is HEAD's bundle bytes, not HEAD's tree` |
| HEAD at capture | `a5f3abd6b2b96479d964f658e231def4e0bf1441` |
| SDK bundle bytes vs HEAD | match - `public/sdk.js` and `public/sdk.min.js` are byte-identical to the blobs committed at `a5f3abd6b2b96479d964f658e231def4e0bf1441` (compared via `git show HEAD:<path>` sha256, not via `git status`) |
| Bundle inputs at capture | clean - `src/sdk/index.ts` and both bundles are unmodified in the working tree |
| Working tree at capture | **DIRTY** - 3 uncommitted path(s): `src/lib/struggle/baselines.ts`, `tests/baselines-dwell-grouping.test.ts`, `tests/browser-evidence.test.ts`. This capture executed the committed SDK bundle bytes above, NOT the working tree of `a5f3abd6b2b96479d964f658e231def4e0bf1441` |
| Chromium | `Chromium 154.0.8037.57 built on Debian GNU/Linux 12 (bookworm)` (`/usr/bin/chromium`) |
| Node | `v22.23.2` |
| `public/sdk.js` sha256 | `a0250c34e9dfec651bf9061a18f2301fe07eaa4e19334d63d0f0a592298da5cc` |
| `public/sdk.min.js` sha256 | `c7241244b195ad059a79819fe25ef9b58b5e0f0c7024acf471ffc1bda84bca29` |

Command: `pnpm exec vitest run tests/browser-evidence.test.ts`

## 0. Source provenance at capture

```json
{
  "headAtCapture": "a5f3abd6b2b96479d964f658e231def4e0bf1441",
  "workingTreeDirtyAtCapture": true,
  "dirtyPathsAtCapture": [
    "src/lib/struggle/baselines.ts",
    "tests/baselines-dwell-grouping.test.ts",
    "tests/browser-evidence.test.ts"
  ],
  "bundleSourceDirtyAtCapture": false,
  "bundleDirtyPathsAtCapture": [],
  "sdkBundleMatchesHead": true,
  "sdkMinBundleMatchesHead": true,
  "bundleMatchesHead": true,
  "sourceLabel": "SDK bundles are byte-identical to HEAD a5f3abd6b2b96479d964f658e231def4e0bf1441; bundle inputs clean at capture; working tree DIRTY at capture (3 path(s) uncommitted, e.g. src/lib/struggle/baselines.ts, tests/baselines-dwell-grouping.test.ts, tests/browser-evidence.test.ts) - the capture is HEAD's bundle bytes, not HEAD's tree"
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
      "idempotencyKey": "sh_sess_1790584192969_i9dbe1dg_1790584192977_jxnyvege",
      "sessionId": "sh_sess_1790584192969_i9dbe1dg",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "FOCUS",
      "ts": "2026-09-28T08:29:52.977Z",
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
      "idempotencyKey": "sh_sess_1790584192969_i9dbe1dg_1790584192977_yp86rf9i",
      "sessionId": "sh_sess_1790584192969_i9dbe1dg",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "CLICK",
      "ts": "2026-09-28T08:29:52.977Z",
      "meta": {},
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
      "idempotencyKey": "sh_sess_1790584192969_i9dbe1dg_1790584192978_9akm65yb",
      "sessionId": "sh_sess_1790584192969_i9dbe1dg",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "BLUR",
      "ts": "2026-09-28T08:29:52.978Z",
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 8
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
      "idempotencyKey": "sh_sess_1790584192969_i9dbe1dg_1790584192978_537ywl6k",
      "sessionId": "sh_sess_1790584192969_i9dbe1dg",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "FOCUS",
      "ts": "2026-09-28T08:29:52.978Z",
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 8
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
      "idempotencyKey": "sh_sess_1790584192969_i9dbe1dg_1790584192979_bufgnj2c",
      "sessionId": "sh_sess_1790584192969_i9dbe1dg",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "CLICK",
      "ts": "2026-09-28T08:29:52.979Z",
      "meta": {},
      "page": {
        "viewportW": 1280,
        "viewportH": 720,
        "formFactor": "desktop",
        "ageMs": 9
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
