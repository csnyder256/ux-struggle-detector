import { JSDOM } from 'jsdom'

/**
 * Node test environment: give the SDK a real document to talk to.
 *
 * The SDK is browser code - it listens on `document`, walks `history`, reads
 * `sessionStorage` and calls `getComputedStyle`. Those cannot be faked with a
 * mock object without testing the mock, so install a live jsdom window.
 */
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
const g = globalThis as unknown as Record<string, unknown>

function define(key: string, value: unknown): void {
  // Node 22 exposes some of these as getter-only globals (navigator), so a
  // plain assignment throws; defineProperty is the portable way in.
  Object.defineProperty(globalThis, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  })
}

const w = dom.window
define('window', w)
define('document', w.document)
define('navigator', w.navigator)
for (const key of [
  'location',
  'history',
  'sessionStorage',
  'localStorage',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'HTMLSelectElement',
  'HTMLButtonElement',
  'HTMLFormElement',
  'Element',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'EventTarget',
  'MutationObserver',
  'getComputedStyle',
] as const) {
  define(key, (w as unknown as Record<string, unknown>)[key])
}

// jsdom ships `window.crypto` without WebCrypto (`subtle`), but the SDK hashes
// element IDs through `crypto.subtle` - the API a real browser provides. Put
// the real WebCrypto global on the window so the SDK's own code path runs;
// nothing about the hashing itself is stubbed.
if (!w.crypto?.subtle) {
  Object.defineProperty(w, 'crypto', {
    value: globalThis.crypto,
    writable: true,
    configurable: true,
  })
}

void g
