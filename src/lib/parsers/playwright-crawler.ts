/**
 * Headless-browser crawler - renders an SPA in chromium, waits for hydration,
 * then extracts interactive elements from the post-render DOM.
 *
 * The plain-fetch crawler (HttpCrawler) only sees the initial HTML shell of an
 * SPA, which contains zero interactive elements for React / Vue / Svelte / etc.
 * apps that hydrate client-side. This crawler runs the page in a real browser
 * so it sees what users actually see.
 *
 * Trade-offs:
 *   - Slower (~1–5s) vs the regex crawler (~100ms)
 *   - Requires the chromium binary: `pnpm exec playwright install chromium`
 *   - Heavier on memory (~150MB per launch)
 *
 * Recommended path:
 *   - Default to the regex crawler.
 *   - Customer toggles "Use headless browser" for SPA-shell sites or when the
 *     plain crawl returns suspiciously few elements.
 */

import { buildMapFromHtml } from './crawler'
import type { Parser, ParseInput, UIMap } from '@/lib/types/ui-map'

export interface BrowserCrawlInput {
  orgId: string
  url: string
  /** Wait for network idle this long. Default 1500ms. */
  networkIdleMs?: number
  /** Hard navigation timeout. Default 30s. */
  navigationTimeoutMs?: number
  /** Wait at least this long after load to give frameworks time to hydrate. */
  postLoadWaitMs?: number
}

export interface BrowserCrawlResult {
  uiMap: UIMap
  fetched: { url: string; status: number; bytes: number; renderedFor: number }
}

export class PlaywrightCrawler implements Parser {
  readonly id = 'playwright-crawler'

  async parse(_input: ParseInput): Promise<UIMap> {
    throw new Error(
      'PlaywrightCrawler does not support source.kind === "repo". Call crawlUrl() instead.',
    )
  }

  async crawlUrl(input: BrowserCrawlInput): Promise<BrowserCrawlResult> {
    // Lazy-import so the rest of the app doesn't pay the ~250 MB load cost
    // unless the customer actually triggers a headless crawl. Throws a clear
    // message if Playwright or its chromium binary isn't installed.
    let playwright: typeof import('playwright')
    try {
      playwright = await import('playwright')
    } catch {
      throw new Error(
        'Playwright is not installed. Run `pnpm add playwright` and `pnpm exec playwright install chromium`.',
      )
    }

    const navTimeout = input.navigationTimeoutMs ?? 30_000
    const networkIdle = input.networkIdleMs ?? 1500
    const postLoad = input.postLoadWaitMs ?? 800

    const start = Date.now()
    let browser: import('playwright').Browser | null = null
    try {
      try {
        browser = await playwright.chromium.launch({ headless: true })
      } catch (err) {
        throw new Error(
          'Failed to launch chromium. Did you run `pnpm exec playwright install chromium`? ' +
            'Original: ' +
            (err instanceof Error ? err.message : 'unknown'),
        )
      }
      const page = await browser.newPage({
        userAgent:
          'Mozilla/5.0 (compatible; ClarusHealHeadless/0.1; +https://clarus-heal.example/crawler)',
        // Privacy: don't ship a real geolocation; default to a neutral viewport.
        viewport: { width: 1280, height: 800 },
      })

      const response = await page.goto(input.url, {
        waitUntil: 'domcontentloaded',
        timeout: navTimeout,
      })
      const status = response?.status() ?? 0

      // Two heuristics chained: "network idle" (no requests in 500ms) plus a
      // small post-load delay for slow framework hydration. We don't trust
      // load events alone - they fire too early on bundle splitters.
      try {
        await page.waitForLoadState('networkidle', { timeout: networkIdle })
      } catch {
        // Some pages never go fully idle (analytics polling). Continue.
      }
      if (postLoad > 0) {
        await page.waitForTimeout(postLoad)
      }

      const html = await page.content()
      const renderedFor = Date.now() - start
      const uiMap = await buildMapFromHtml(input.orgId, input.url, html)
      return {
        uiMap,
        fetched: { url: input.url, status, bytes: html.length, renderedFor },
      }
    } finally {
      if (browser) {
        try {
          await browser.close()
        } catch {
          // ignore - process is ending
        }
      }
    }
  }
}

/**
 * Heuristic: looks like the HTML is an SPA shell that needs a headless browser?
 *
 * Signals:
 *   - body has fewer than 8 of our target tags (button/input/etc)
 *   - has a #root / #app / .react-root container that's empty or near-empty
 *   - has a <script type="module"> tag (modern SPA shells)
 *
 * Returns `true` when we should suggest the headless path. False = the plain
 * fetch was already useful.
 */
export function looksLikeSpaShell(html: string): boolean {
  // Cheap interactive-element count.
  const interactiveCount = (html.match(/<(?:button|input|textarea|select|form|a)\b/gi) ?? []).length
  if (interactiveCount >= 8) return false

  // Body is mostly empty + has a known SPA mount node?
  const hasMount = /<div[^>]+id=["'](?:root|app|__next|svelte)["']/i.test(html)
  if (hasMount && interactiveCount < 4) return true

  // Module scripts + low element count = probably a Vite/SvelteKit shell.
  const hasModuleScripts = /<script[^>]+type=["']module["']/i.test(html)
  if (hasModuleScripts && interactiveCount < 4) return true

  return false
}
