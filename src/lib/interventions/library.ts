/**
 * Intervention copy library - every struggle type has one or more candidate
 * interventions, ranked by what feels right for the situation.
 *
 * The dispatcher picks one (or runs them as A/B variants). Each entry is a
 * template; `{label}` and `{route}` get filled in at dispatch time.
 *
 * Default interventions are intentionally simple display-family (highlight /
 * tooltip / banner). Anything more invasive (DOM / BEHAVIOR / AUTO_FIX)
 * requires explicit allowlisting per the safety model.
 */

import type { StruggleType, InterventionRenderType } from '@/lib/types/events'

export interface InterventionTemplate {
  type: InterventionRenderType
  /** Plain-text copy. {label} = element label; {route} = current route. */
  copy: string
  /** Optional headline (used by MODAL / BANNER / ARROW). */
  title?: string
  /** Where to anchor / target. 'self' = the element from the struggle event. */
  target?: 'self' | 'sibling-button' | 'submit-button' | 'help' | 'page'
  autoDismissMs?: number
  /** A/B variants beyond the first will share this group string. */
  variantGroup?: string
  /** Banner severity (BANNER renderer only). */
  severity?: 'info' | 'warning' | 'error'
}

export const STRUGGLE_INTERVENTIONS: Record<StruggleType, InterventionTemplate[]> = {
  RAGE_CLICK: [
    {
      type: 'HIGHLIGHT',
      copy: 'Hold tight - this might take a moment. We&rsquo;ve highlighted what to try next.',
      target: 'self',
      autoDismissMs: 6000,
      variantGroup: 'rage-click',
    },
    {
      type: 'TOOLTIP',
      copy: 'Looks like you&rsquo;re trying to {label}. Give it a moment, or try the highlighted option.',
      target: 'self',
      autoDismissMs: 8000,
      variantGroup: 'rage-click',
    },
  ],
  DEAD_CLICK: [
    {
      type: 'TOOLTIP',
      copy: 'That&rsquo;s not clickable - try the highlighted control instead.',
      target: 'sibling-button',
      autoDismissMs: 7000,
    },
  ],
  INVALID_CLICK: [
    {
      type: 'TOOLTIP',
      copy: '{label} is disabled until earlier fields are filled.',
      target: 'self',
      autoDismissMs: 8000,
    },
  ],
  MIS_CLICK: [
    {
      type: 'HIGHLIGHT',
      copy: 'Tap precisely on the highlighted target.',
      target: 'self',
      autoDismissMs: 4000,
    },
  ],
  THRASH: [
    {
      type: 'INLINE_HINT',
      copy: 'Almost there - try a shorter / cleaner value.',
      target: 'self',
    },
  ],
  BACKTRACK: [
    {
      type: 'INLINE_HINT',
      copy: 'Take your time. We auto-save your draft.',
      target: 'self',
    },
  ],
  VALIDATION_LOOP: [
    {
      type: 'BANNER',
      copy: 'A few fields still need attention. Scroll up - they&rsquo;re highlighted.',
      title: 'Form needs a quick fix',
    },
  ],
  ABANDONED_FIELD: [
    {
      type: 'OVERLAY',
      copy: 'Need a hand finishing this? We can save it as a draft.',
      autoDismissMs: 12000,
    },
  ],
  PASTE_REPEAT: [
    {
      type: 'INLINE_HINT',
      copy: 'Pasted multiple times - only the last value sticks.',
      target: 'self',
    },
  ],
  REQUIRED_MISSED: [
    {
      type: 'HIGHLIGHT',
      copy: '{label} {validation}.',
      target: 'self',
      autoDismissMs: 10000,
    },
  ],
  FORMAT_ERROR: [
    {
      type: 'INLINE_HINT',
      copy: '{label} {validation}.',
      target: 'self',
    },
  ],
  PASSWORD_RETRY: [
    {
      type: 'OVERLAY',
      copy: 'Password reset link is on the sign-in page if you need it.',
      autoDismissMs: 10000,
    },
  ],
  SLOW_FILL: [
    {
      type: 'OVERLAY',
      copy: 'You can save and come back to this later from your account.',
      autoDismissMs: 8000,
    },
  ],
  LOOP: [
    {
      type: 'BANNER',
      copy: 'You&rsquo;ve been here a few times - looking for something specific?',
      title: 'Help finding something?',
    },
    {
      type: 'OVERLAY',
      copy: 'Looks like you&rsquo;re bouncing - check the help link in the header.',
    },
  ],
  SILENT_FAIL: [
    {
      type: 'BANNER',
      copy: 'It looks like that didn&rsquo;t go through - try the highlighted action again.',
      title: 'Something didn&rsquo;t happen',
      target: 'self',
    },
  ],
  BACK_THRASH: [
    {
      type: 'OVERLAY',
      copy: 'Lost? Use the breadcrumb - we&rsquo;ve highlighted it.',
      target: 'help',
      autoDismissMs: 8000,
    },
  ],
  DEAD_END: [
    {
      type: 'OVERLAY',
      copy: 'Need help? The support button is in the bottom right.',
      target: 'help',
      autoDismissMs: 8000,
    },
  ],
  QUICK_BOUNCE: [
    {
      type: 'OVERLAY',
      copy: 'Wrong page? Search bar is up top.',
      target: 'help',
      autoDismissMs: 6000,
    },
  ],
  CIRCULAR_NAV: [
    {
      type: 'BANNER',
      copy: 'Bouncing between two pages - the action you might want is here.',
      target: 'self',
    },
  ],
  HOVER_HUNT: [
    {
      type: 'TOOLTIP',
      copy: 'Looking for {label}? Click anywhere on this row.',
      target: 'self',
      autoDismissMs: 6000,
    },
  ],
  LONG_DWELL: [
    {
      type: 'OVERLAY',
      copy: 'Stuck? Try the highlighted next step.',
      target: 'submit-button',
      autoDismissMs: 8000,
    },
  ],
  RAPID_SCROLL: [
    {
      type: 'OVERLAY',
      copy: 'Looking for something? Try the search bar.',
      target: 'help',
      autoDismissMs: 6000,
    },
  ],
  SCROLL_OVERSHOOT: [
    {
      type: 'HIGHLIGHT',
      copy: 'Here&rsquo;s the section you scrolled past.',
      target: 'self',
      autoDismissMs: 5000,
    },
  ],
  IDLE_AFTER_LOAD: [
    {
      type: 'TOUR',
      copy: 'New here? Quick tour of what&rsquo;s on this page.',
      title: 'Quick tour',
    },
  ],
  EMPTY_SEARCH: [
    {
      type: 'INLINE_HINT',
      copy: 'Type a few characters to search.',
      target: 'self',
    },
  ],
  REPEAT_SEARCH: [
    {
      type: 'OVERLAY',
      copy: 'Same query? Try a different phrasing or a filter.',
      autoDismissMs: 7000,
    },
  ],
  ZERO_RESULTS: [
    {
      type: 'BANNER',
      copy: 'No results - try fewer or different keywords.',
      severity: 'warning',
    },
  ],
  FAILED_FILTER: [
    {
      type: 'INLINE_HINT',
      copy: 'No matches - try loosening one of the filters.',
      target: 'self',
    },
  ],
  MENU_THRASH: [
    {
      type: 'TOOLTIP',
      copy: 'Trying to find {label}? It&rsquo;s here.',
      target: 'self',
      autoDismissMs: 5000,
    },
  ],
  TOOLTIP_HOVER_REPEAT: [
    {
      type: 'INLINE_HINT',
      copy: 'Need more detail? See the docs link.',
      target: 'help',
    },
  ],
  TAB_HOPPING: [
    {
      type: 'OVERLAY',
      copy: 'Welcome back. Picking up where you left off.',
      autoDismissMs: 4000,
    },
  ],
  ERROR_DISMISS: [
    {
      type: 'BANNER',
      copy: 'Same error keeps coming up - try the highlighted fix.',
      severity: 'warning',
    },
  ],
  RETRY_LOOP: [
    {
      type: 'MODAL',
      copy: 'Retries aren&rsquo;t working. Mind sharing what you&rsquo;re trying to do?',
      title: 'Looks stuck',
    },
  ],
  NOT_FOUND_BOUNCE: [
    {
      type: 'OVERLAY',
      copy: 'That page is gone. Try the search bar - top of the page.',
      target: 'help',
      autoDismissMs: 8000,
    },
  ],
  JS_ERROR: [
    {
      type: 'BANNER',
      copy: 'Something on this page glitched. Refresh might help.',
      severity: 'error',
    },
  ],
  LOGIN_FAILURE: [
    {
      type: 'INLINE_HINT',
      copy: 'Wrong password? Reset link is below.',
      target: 'help',
    },
  ],
  LOCKED_OUT: [
    {
      type: 'MODAL',
      copy: 'Too many login attempts. Reset your password to continue.',
      title: 'Account paused',
    },
  ],
  KEYBOARD_LOST_FOCUS: [
    {
      type: 'TOOLTIP',
      copy: 'Click into the field again to type.',
      target: 'self',
      autoDismissMs: 4000,
    },
  ],
  COPY_BOUNCE: [
    {
      type: 'OVERLAY',
      copy: 'Saved that for you. Come back any time.',
      autoDismissMs: 4000,
    },
  ],
  HELP_HUNT: [
    {
      type: 'TOUR',
      copy: 'Quick walkthrough of common tasks.',
      title: 'Help is here',
    },
  ],
}
