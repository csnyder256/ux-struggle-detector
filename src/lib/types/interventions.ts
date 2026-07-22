/**
 * Intervention schema - the runtime payloads the SDK renders.
 *
 * 15 renderer types live in this enum. Three families:
 *   - DISPLAY (always safe): OVERLAY, HIGHLIGHT, TOOLTIP, MODAL, BANNER,
 *     INLINE_HINT, SPOTLIGHT, TOUR, ICON_FLASH, ARROW
 *   - MODIFY (gated by per-page allowlist): DOM, BEHAVIOR, AUTO_FIX
 *   - COMMUNICATE (low-friction prompts): CONFIRM, ANNOUNCE
 */

import type { ElementId } from './ui-map'

export type InterventionType =
  | 'OVERLAY'
  | 'HIGHLIGHT'
  | 'TOOLTIP'
  | 'MODAL'
  | 'BANNER'
  | 'INLINE_HINT'
  | 'SPOTLIGHT'
  | 'TOUR'
  | 'ICON_FLASH'
  | 'ARROW'
  | 'DOM'
  | 'BEHAVIOR'
  | 'AUTO_FIX'
  | 'CONFIRM'
  | 'ANNOUNCE'

export type InterventionOutcome = 'SUCCESS' | 'ABANDON' | 'DISMISSED'

// ─────────────────────────────────────────────────────────────────────────────
// Per-type config payloads (server → SDK over /api/events response)
// ─────────────────────────────────────────────────────────────────────────────

export interface OverlayConfig {
  type: 'OVERLAY'
  copy: string
  anchor?: 'top-right' | 'bottom-right' | 'bottom-left' | 'top-left'
  dismissible: true
}

export interface HighlightConfig {
  type: 'HIGHLIGHT'
  /** Element to highlight. */
  targetElementId: ElementId
  copy?: string
  /** "spotlight" dims everything outside the target ring. */
  style?: 'pulse' | 'spotlight' | 'glow'
  durationMs?: number
}

export interface TooltipConfig {
  type: 'TOOLTIP'
  targetElementId: ElementId
  copy: string
  anchor?: 'top' | 'bottom' | 'left' | 'right'
}

export interface ModalConfig {
  type: 'MODAL'
  title: string
  copy: string
  cta?: { label: string; targetElementId?: ElementId }
}

export interface BannerConfig {
  type: 'BANNER'
  copy: string
  severity?: 'info' | 'warning' | 'error'
}

export interface InlineHintConfig {
  type: 'INLINE_HINT'
  targetElementId: ElementId
  copy: string
}

export interface SpotlightConfig {
  type: 'SPOTLIGHT'
  targetElementId: ElementId
  copy?: string
}

export interface TourStep {
  targetElementId: ElementId
  copy: string
}
export interface TourConfig {
  type: 'TOUR'
  steps: TourStep[]
  title?: string
}

export interface IconFlashConfig {
  type: 'ICON_FLASH'
  targetElementId: ElementId
  copy?: string
}

export interface ArrowConfig {
  type: 'ARROW'
  /** Anchor element for the arrow base. */
  fromElementId?: ElementId
  /** Where the arrow points. */
  toElementId: ElementId
  copy?: string
}

export interface DomConfig {
  type: 'DOM'
  selectors: string[]
  mutation:
    | { kind: 'HIDE' }
    | { kind: 'STYLE'; styles: Record<string, string> }
    | { kind: 'REORDER'; before: ElementId; after: ElementId }
}

export interface BehaviorConfig {
  type: 'BEHAVIOR'
  handler: 'AUTOFILL' | 'PREVENT_SUBMIT' | 'REDIRECT'
  payload: Record<string, string | number | boolean>
}

export interface AutoFixConfig {
  type: 'AUTO_FIX'
  description: string
  /** What we'd do - user must confirm before action runs. */
  proposed: { kind: 'CLICK' | 'FILL' | 'NAVIGATE'; targetElementId?: ElementId; value?: string }
}

export interface ConfirmConfig {
  type: 'CONFIRM'
  copy: string
  cta?: { label: string; targetElementId?: ElementId }
}

export interface AnnounceConfig {
  type: 'ANNOUNCE'
  copy: string
  /** aria-live politeness. */
  level?: 'polite' | 'assertive'
}

export type InterventionConfig =
  | OverlayConfig
  | HighlightConfig
  | TooltipConfig
  | ModalConfig
  | BannerConfig
  | InlineHintConfig
  | SpotlightConfig
  | TourConfig
  | IconFlashConfig
  | ArrowConfig
  | DomConfig
  | BehaviorConfig
  | AutoFixConfig
  | ConfirmConfig
  | AnnounceConfig

// ─────────────────────────────────────────────────────────────────────────────
// Persisted intervention record
// ─────────────────────────────────────────────────────────────────────────────

export interface Intervention {
  id: string
  orgId: string
  elementId: ElementId
  type: InterventionType
  config: InterventionConfig
  enabled: boolean
  variantGroup: string | null
  impressions: number
  successes: number
  dismissals: number
  successRate: number
  createdAt: string
  updatedAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Failure analysis (Phase 7 LLM glue)
// ─────────────────────────────────────────────────────────────────────────────

export interface RecommendedIntervention {
  type: InterventionType
  config: InterventionConfig
  rationale: string
}

export interface FailureAnalysisResult {
  rootCause: string
  confidence: number
  recommendations: RecommendedIntervention[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Safety (Phase 13)
// ─────────────────────────────────────────────────────────────────────────────

export interface SafetyGates {
  globalEnabled: boolean
  safeMode: boolean
  routeDenylist: string[]
  invasiveAllowlist: string[]
}

export const DEFAULT_SAFETY_GATES: SafetyGates = {
  globalEnabled: true,
  safeMode: true,
  routeDenylist: [],
  invasiveAllowlist: [],
}

/** Display-family interventions are always allowed. Modify-family is gated. */
export function isDisplayIntervention(t: InterventionType): boolean {
  return [
    'OVERLAY',
    'HIGHLIGHT',
    'TOOLTIP',
    'MODAL',
    'BANNER',
    'INLINE_HINT',
    'SPOTLIGHT',
    'TOUR',
    'ICON_FLASH',
    'ARROW',
    'CONFIRM',
    'ANNOUNCE',
  ].includes(t)
}
