import { describe, it, expect } from 'vitest'
import { looksLikeSpaShell } from '@/lib/parsers/playwright-crawler'

describe('looksLikeSpaShell', () => {
  it('returns false on a content-rich page', () => {
    const html = `
      <html><body>
        <header><a href="/">Home</a><a href="/about">About</a></header>
        <main>
          <form><input type="email" /><button>Subscribe</button></form>
          <button>Login</button>
          <button>Sign up</button>
          <a href="/docs">Docs</a>
          <a href="/blog">Blog</a>
          <input type="text" />
        </main>
      </body></html>
    `
    expect(looksLikeSpaShell(html)).toBe(false)
  })

  it('returns true on a Next.js empty shell with __next mount', () => {
    const html = `
      <html><body>
        <div id="__next"></div>
        <script type="module" src="/_next/static/chunks/main.js"></script>
      </body></html>
    `
    expect(looksLikeSpaShell(html)).toBe(true)
  })

  it('returns true on a React empty root', () => {
    const html = `
      <html><body>
        <div id="root"></div>
        <script src="/static/main.bundle.js"></script>
      </body></html>
    `
    expect(looksLikeSpaShell(html)).toBe(true)
  })

  it('returns true on a Vite/SvelteKit shell with module scripts and few elements', () => {
    const html = `
      <html><body>
        <div id="svelte"></div>
        <script type="module" src="/src/main.ts"></script>
      </body></html>
    `
    expect(looksLikeSpaShell(html)).toBe(true)
  })

  it('returns false when SPA mount exists but page already has interactive elements', () => {
    const html = `
      <html><body>
        <div id="root">
          <button>One</button><button>Two</button><button>Three</button>
          <button>Four</button>
          <input /><input /><input /><input />
        </div>
      </body></html>
    `
    expect(looksLikeSpaShell(html)).toBe(false)
  })

  it('returns false on plain SSR output without module scripts', () => {
    const html = `
      <html><body>
        <h1>About us</h1>
        <p>Some content</p>
        <a href="/contact">Contact</a>
      </body></html>
    `
    expect(looksLikeSpaShell(html)).toBe(false)
  })
})
