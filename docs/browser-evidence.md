# Browser evidence — runtime validation & SDK capture (PR #38)

Captured with **headless Chromium driving the built SDK bundle** — not jsdom.

| Fact | Value |
| --- | --- |
| Source head | `a9422a1d5ed7f30f246a77245f5a06186a993a26` |
| Chromium | `Chromium 154.0.8037.57 built on Debian GNU/Linux 12 (bookworm)` (`/usr/bin/chromium`) |
| Node | `v22.23.2` |
| `public/sdk.js` sha256 | `a0250c34e9dfec651bf9061a18f2301fe07eaa4e19334d63d0f0a592298da5cc` |
| `public/sdk.min.js` sha256 | `c7241244b195ad059a79819fe25ef9b58b5e0f0c7024acf471ffc1bda84bca29` |

Command: `pnpm exec vitest run tests/browser-evidence.test.ts`

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
      "idempotencyKey": "sh_sess_1790580776345_of0uxy83_1790580776353_ymon1ebs",
      "sessionId": "sh_sess_1790580776345_of0uxy83",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "FOCUS",
      "ts": "2026-09-28T07:32:56.353Z",
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
      "idempotencyKey": "sh_sess_1790580776345_of0uxy83_1790580776354_ck24gl66",
      "sessionId": "sh_sess_1790580776345_of0uxy83",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "CLICK",
      "ts": "2026-09-28T07:32:56.354Z",
      "meta": {},
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
      "idempotencyKey": "sh_sess_1790580776345_of0uxy83_1790580776354_08wid1u0",
      "sessionId": "sh_sess_1790580776345_of0uxy83",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "BLUR",
      "ts": "2026-09-28T07:32:56.354Z",
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
      "idempotencyKey": "sh_sess_1790580776345_of0uxy83_1790580776355_bttw2gde",
      "sessionId": "sh_sess_1790580776345_of0uxy83",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "FOCUS",
      "ts": "2026-09-28T07:32:56.355Z",
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
    },
    {
      "schemaVersion": 3,
      "idempotencyKey": "sh_sess_1790580776345_of0uxy83_1790580776355_ziiihvk8",
      "sessionId": "sh_sess_1790580776345_of0uxy83",
      "userIdHash": null,
      "elementId": null,
      "route": "blank",
      "eventType": "CLICK",
      "ts": "2026-09-28T07:32:56.355Z",
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
