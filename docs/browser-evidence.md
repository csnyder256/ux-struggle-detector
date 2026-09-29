# Browser evidence — runtime validation & SDK capture (PR #38)

Captured with **headless Chromium driving the built SDK bundle** — not jsdom.

| Fact | Value |
| --- | --- |
| Source (at capture) | `SDK bundles are byte-identical to HEAD b5456f4e5035e12a8d0a9d3ac58afa76c9f6e505; bundle inputs dirty at capture (src/sdk/index.ts); working tree DIRTY at capture (20 path(s) uncommitted, e.g. .gitignore, VERSION, package.json, public/demo/index.html) - the capture uses the measured bundle bytes and records working-tree edits` |
| HEAD at capture | `b5456f4e5035e12a8d0a9d3ac58afa76c9f6e505` |
| SDK bundle bytes vs HEAD | match - `public/sdk.js` and `public/sdk.min.js` are byte-identical to the blobs committed at `b5456f4e5035e12a8d0a9d3ac58afa76c9f6e505` (compared via `git show HEAD:<path>` sha256, not via `git status`) |
| Bundle inputs at capture | **dirty** - uncommitted edits to `src/sdk/index.ts` |
| Working tree at capture | **DIRTY** - 20 uncommitted path(s): `.gitignore`, `VERSION`, `package.json`, `public/demo/index.html`, `release.json`, `src/sdk/element-id.ts`, `src/sdk/index.ts`, `src/sdk/renderers.ts`, `src/sdk/transport.ts`, `tsconfig.json`, `packages/`, `public/demo/demo.js`, `public/demo/style.css`, `scripts/build-sdk-package.mjs`, `src/demo/`, `src/sdk/package-entry.ts`, `src/sdk/script-entry.ts`, `src/sdk/tours.ts`, `tests/sdk-lifecycle-tour.test.ts`, `tsconfig.sdk.json`. This capture records the measured SDK bundle bytes above and uncommitted paths relative to `b5456f4e5035e12a8d0a9d3ac58afa76c9f6e505` |
| Chromium | `Chromium 154.0.8037.57 built on Debian GNU/Linux 12 (bookworm)` (`/usr/bin/chromium`) |
| Node | `v22.23.2` |
| `public/sdk.js` sha256 | `27e973f89e3b1387f91c4c0a4d8031c199ceb1f32f9866cfccd61e2ce7c97728` |
| `public/sdk.min.js` sha256 | `6dbd4139d426e14114ee24c7a06ee7f0c861401f7f36639090dbde9794af49a6` |

Command: `pnpm exec vitest run tests/browser-evidence.test.ts`

## 0. Source provenance at capture

```json
{
  "headAtCapture": "b5456f4e5035e12a8d0a9d3ac58afa76c9f6e505",
  "workingTreeDirtyAtCapture": true,
  "dirtyPathsAtCapture": [
    ".gitignore",
    "VERSION",
    "package.json",
    "public/demo/index.html",
    "release.json",
    "src/sdk/element-id.ts",
    "src/sdk/index.ts",
    "src/sdk/renderers.ts",
    "src/sdk/transport.ts",
    "tsconfig.json",
    "packages/",
    "public/demo/demo.js",
    "public/demo/style.css",
    "scripts/build-sdk-package.mjs",
    "src/demo/",
    "src/sdk/package-entry.ts",
    "src/sdk/script-entry.ts",
    "src/sdk/tours.ts",
    "tests/sdk-lifecycle-tour.test.ts",
    "tsconfig.sdk.json"
  ],
  "bundleSourceDirtyAtCapture": true,
  "bundleDirtyPathsAtCapture": [
    "src/sdk/index.ts"
  ],
  "sdkBundleMatchesHead": true,
  "sdkMinBundleMatchesHead": true,
  "bundleMatchesHead": true,
  "sourceLabel": "SDK bundles are byte-identical to HEAD b5456f4e5035e12a8d0a9d3ac58afa76c9f6e505; bundle inputs dirty at capture (src/sdk/index.ts); working tree DIRTY at capture (20 path(s) uncommitted, e.g. .gitignore, VERSION, package.json, public/demo/index.html) - the capture uses the measured bundle bytes and records working-tree edits"
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
      "idempotencyKey": "sh_sess_1790662351418_2skb1dxg_1790662351427_qbs22wms",
      "sessionId": "sh_sess_1790662351418_2skb1dxg",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "FOCUS",
      "ts": "2026-09-29T06:12:31.427Z",
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
      "idempotencyKey": "sh_sess_1790662351418_2skb1dxg_1790662351429_eluivyy6",
      "sessionId": "sh_sess_1790662351418_2skb1dxg",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "CLICK",
      "ts": "2026-09-29T06:12:31.429Z",
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
      "idempotencyKey": "sh_sess_1790662351418_2skb1dxg_1790662351430_bbhi3nxj",
      "sessionId": "sh_sess_1790662351418_2skb1dxg",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "BLUR",
      "ts": "2026-09-29T06:12:31.430Z",
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
      "idempotencyKey": "sh_sess_1790662351418_2skb1dxg_1790662351430_2i5cbi1g",
      "sessionId": "sh_sess_1790662351418_2skb1dxg",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "FOCUS",
      "ts": "2026-09-29T06:12:31.430Z",
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
      "idempotencyKey": "sh_sess_1790662351418_2skb1dxg_1790662351431_je9q96nj",
      "sessionId": "sh_sess_1790662351418_2skb1dxg",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "CLICK",
      "ts": "2026-09-29T06:12:31.431Z",
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
