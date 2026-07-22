/**
 * ModelProvider - the universal interface for any LLM backing the system.
 *
 * Every provider implements both `deep()` and `fast()` because the system
 * always has two cost / latency / capability profiles regardless of which
 * vendor is wired up. The two-key model is preserved even when the customer
 * uses the same key for both - we still resolve them as independent
 * provider instances so rate-limit pools and usage counters stay separate.
 *
 * Adding a new vendor (Google, Mistral, a self-hosted endpoint) is one new
 * file in this directory plus a case in `registry.ts` - never a refactor.
 */

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'custom'

export interface DeepRequest {
  systemPrompt: string
  userPrompt: string
  /**
   * Optional JSON Schema for structured output. When set, the provider must
   * return `parsed` with a value matching the schema. Used during platform
   * mapping to guarantee parseable enrichments.
   */
  jsonSchema?: Record<string, unknown>
  maxTokens?: number
  /** Override the provider's default deep-tier model. */
  model?: string
}

export interface DeepResponse {
  content: string
  parsed?: unknown
  usage: { inputTokens: number; outputTokens: number }
}

export interface FastRequest {
  systemPrompt: string
  userPrompt: string
  maxTokens?: number
  model?: string
}

export interface FastResponse {
  content: string
  usage: { inputTokens: number; outputTokens: number }
}

export interface ModelProvider {
  readonly id: ProviderId
  deep(input: DeepRequest): Promise<DeepResponse>
  fast(input: FastRequest): Promise<FastResponse>
}
