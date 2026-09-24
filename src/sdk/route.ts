/**
 * Where the user is, for any client-side router.
 *
 * History-mode routers (Next, Remix, React Router, SvelteKit, Vue/Angular in
 * history mode) keep the route in `location.pathname`. Hash-mode routers
 * (Vue Router hash history, Angular HashLocationStrategy, AngularJS `#!`,
 * many embedded and legacy SPAs) keep it in the fragment, and every screen
 * shares the same pathname. Reporting `pathname` alone makes every screen of
 * a hash-routed app look like `/`, so route-based rules (loops, circular
 * navigation, dead ends, the per-route denylist) cannot tell screens apart.
 *
 * A fragment is treated as a route only when it looks like one (`#/...` or
 * `#!/...`). An in-page anchor such as `#pricing` is not a navigation.
 */

export interface LocationLike {
  pathname: string
  search: string
  hash: string
}

export function routeFromLocation(loc: Pick<LocationLike, 'pathname' | 'hash'>): string {
  const hash = loc.hash
  const hashRoute = hash.startsWith('#!/') ? hash.slice(2) : hash.startsWith('#/') ? hash.slice(1) : null
  if (hashRoute === null) return loc.pathname || '/'
  const end = hashRoute.search(/[?#]/)
  const route = end === -1 ? hashRoute : hashRoute.slice(0, end)
  return route || '/'
}

/**
 * Decides whether a history change is a navigation worth recording.
 *
 * `pushState` and genuine `popstate` traversals (back/forward) always count:
 * they are explicit moves, and back-button thrash is detected from repeated
 * popstates. `replaceState` and forward fragment moves (`hashchange`) count
 * only when the route changed. Routers call `replaceState` to stash scroll
 * state or sync a search box into the query string, an in-page anchor like
 * `#faq` scrolls rather than navigates, and one fragment move fires both
 * `popstate` and `hashchange`. Recording any of those would invent loops and
 * thrash the user never made.
 */
export type NavigationTrigger = 'initial' | 'pushstate' | 'popstate' | 'replacestate' | 'hashchange'

export class NavigationTracker {
  private lastRoute: string

  constructor(initial: Pick<LocationLike, 'pathname' | 'hash'>) {
    this.lastRoute = routeFromLocation(initial)
  }

  shouldRecord(trigger: NavigationTrigger, loc: Pick<LocationLike, 'pathname' | 'hash'>): boolean {
    const route = routeFromLocation(loc)
    const changed = route !== this.lastRoute
    this.lastRoute = route
    if (trigger === 'replacestate' || trigger === 'hashchange') return changed
    return true
  }
}

/**
 * Classifies a `popstate`. Browsers fire it both for back/forward and for a
 * forward move to a new fragment (clicking `<a href="#/cart">`, assigning
 * `location.hash`). Only the first is a return trip; counting the second as
 * one makes three quick hash-link clicks look like back-button thrash. The
 * Navigation API reports which it was; without it, keep the old reading.
 */
export function classifyPopstate(lastNavigationType: string | null): NavigationTrigger {
  return lastNavigationType === 'push' || lastNavigationType === 'replace' ? 'hashchange' : 'popstate'
}
