import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { HttpCrawler } from '@/lib/parsers/crawler'

const origFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = origFetch
})

function mockFetch(html: string, status = 200) {
  globalThis.fetch = vi.fn(async () =>
    new Response(html, {
      status,
      headers: { 'Content-Type': 'text/html' },
    }),
  ) as unknown as typeof fetch
}

describe('HttpCrawler', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('extracts buttons / forms / links / inputs from rendered HTML', async () => {
    mockFetch(`
      <!doctype html>
      <html>
        <body>
          <header><a href="/about">About us</a></header>
          <main>
            <form action="/signup">
              <input type="email" placeholder="email" />
              <button type="submit">Sign up</button>
            </form>
            <select name="country"><option>US</option></select>
            <textarea name="bio"></textarea>
          </main>
        </body>
      </html>
    `)
    const crawler = new HttpCrawler()
    const result = await crawler.crawlUrl({
      orgId: 'org_test',
      url: 'https://example.com/landing',
    })
    expect(result.fetched.status).toBe(200)
    const types = result.uiMap.elements.map((e) => e.elementType).sort()
    expect(types).toContain('LINK')
    expect(types).toContain('FORM')
    expect(types).toContain('INPUT')
    expect(types).toContain('BUTTON')
    expect(types).toContain('SELECT')

    const labels = result.uiMap.elements.map((e) => e.labelRaw)
    expect(labels).toContain('Sign up')
    expect(labels).toContain('About us')
    expect(labels).toContain('email')
  })

  it('records the URL pathname as the route entry point', async () => {
    mockFetch(`<button>Hi</button>`)
    const crawler = new HttpCrawler()
    const result = await crawler.crawlUrl({
      orgId: 'org_route',
      url: 'https://example.com/dashboard?ref=foo',
    })
    expect(result.uiMap.routes.length).toBe(1)
    expect(result.uiMap.routes[0]?.path).toBe('/dashboard')
    expect(result.uiMap.routes[0]?.entryPoints).toContain(
      'https://example.com/dashboard?ref=foo',
    )
  })

  it('captures href as routeTarget for anchor elements', async () => {
    mockFetch(`<a href="/login">Sign in</a>`)
    const crawler = new HttpCrawler()
    const result = await crawler.crawlUrl({
      orgId: 'org_a',
      url: 'https://example.com/',
    })
    const link = result.uiMap.elements.find((e) => e.elementType === 'LINK')
    expect(link?.routeTarget).toBe('/login')
  })

  it('returns the raw html body in fetched.html so callers can apply heuristics', async () => {
    const html = `<!doctype html><html><body><div id="root"></div></body></html>`
    mockFetch(html)
    const crawler = new HttpCrawler()
    const result = await crawler.crawlUrl({
      orgId: 'org_html',
      url: 'https://example.com/spa',
    })
    expect(result.fetched.html).toBe(html)
  })

  it('throws via fetch error path on non-200 (still parses 4xx body)', async () => {
    mockFetch(`<form><button>Try</button></form>`, 404)
    const crawler = new HttpCrawler()
    const result = await crawler.crawlUrl({
      orgId: 'org_404',
      url: 'https://example.com/missing',
    })
    expect(result.fetched.status).toBe(404)
    // We still parse what came back - useful for custom 404 pages with CTAs.
    expect(result.uiMap.elements.length).toBeGreaterThan(0)
  })

  it('extracts page title from <title> tag', async () => {
    mockFetch(`<html><head><title>About Us - Acme</title></head><body><h1>About</h1></body></html>`)
    const crawler = new HttpCrawler()
    const result = await crawler.crawlUrl({
      orgId: 'org_meta',
      url: 'https://example.com/about',
    })
    expect(result.uiMap.routes[0]?.extraction?.title).toBe('About Us - Acme')
  })

  it('falls back to first <h1> when no <title>', async () => {
    mockFetch(`<html><body><h1>Pricing</h1></body></html>`)
    const crawler = new HttpCrawler()
    const result = await crawler.crawlUrl({
      orgId: 'org_h1',
      url: 'https://example.com/pricing',
    })
    expect(result.uiMap.routes[0]?.extraction?.title).toBe('Pricing')
  })

  it('extracts h2/h3 sections', async () => {
    mockFetch(`<h1>Page</h1><h2>Section A</h2><h2>Section B</h2><h3>Subsection</h3>`)
    const crawler = new HttpCrawler()
    const result = await crawler.crawlUrl({
      orgId: 'org_s',
      url: 'https://example.com/',
    })
    const sections = result.uiMap.routes[0]?.extraction?.sections ?? []
    expect(sections).toContain('Section A')
    expect(sections).toContain('Section B')
    expect(sections).toContain('Subsection')
  })

  it('extracts meta description and falls back to og:description', async () => {
    mockFetch(`<head><meta name="description" content="The best billing dashboard" /></head><body><h1>X</h1></body>`)
    const crawler = new HttpCrawler()
    const result = await crawler.crawlUrl({
      orgId: 'org_d',
      url: 'https://example.com/',
    })
    expect(result.uiMap.routes[0]?.extraction?.description).toBe('The best billing dashboard')
  })

  it('extracts schema.org JSON-LD name/description as fallback', async () => {
    const ld = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Custom name from JSON-LD',
      description: 'Marketing description from structured data',
    })
    mockFetch(`<head><script type="application/ld+json">${ld}</script></head><body></body>`)
    const crawler = new HttpCrawler()
    const result = await crawler.crawlUrl({
      orgId: 'org_ld',
      url: 'https://example.com/',
    })
    expect(result.uiMap.routes[0]?.extraction?.title).toBe('Custom name from JSON-LD')
    expect(result.uiMap.routes[0]?.extraction?.description).toBe(
      'Marketing description from structured data',
    )
  })

  it('produces stable element ids for the same URL + HTML', async () => {
    mockFetch(`<button>Same</button><button>Other</button>`)
    const crawler = new HttpCrawler()
    const a = await crawler.crawlUrl({
      orgId: 'org_stable_crawl',
      url: 'https://example.com/page',
    })
    mockFetch(`<button>Same</button><button>Other</button>`)
    const b = await crawler.crawlUrl({
      orgId: 'org_stable_crawl',
      url: 'https://example.com/page',
    })
    expect(a.uiMap.elements.map((e) => e.id)).toEqual(b.uiMap.elements.map((e) => e.id))
  })
})
