/**
 * ProviderRegistry - resolves the right ModelProvider instance for an
 * (orgId, kind) pair. Reads the encrypted key from the DB and decrypts
 * just-in-time. Never caches plaintext keys; rotation is immediate.
 *
 * The two kinds (DEEP, FAST) are independent provider configs even when
 * the customer uses the same API key for both - separate rate-limit pools,
 * separate usage tracking, separate model defaults.
 */

import { prisma } from '@/lib/db'
import { decryptApiKey } from '@/lib/crypto/keys'
import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'
import type { ModelProvider } from './index'

export type ProviderKind = 'DEEP' | 'FAST'

export class ProviderRegistry {
  static async get(orgId: string, kind: ProviderKind): Promise<ModelProvider> {
    const row = await prisma.providerKey.findUnique({
      where: { orgId_kind: { orgId, kind } },
    })
    if (!row) {
      throw new ProviderNotConfiguredError(orgId, kind)
    }
    const apiKey = decryptApiKey({ ciphertext: row.encryptedKey, iv: row.iv })
    switch (row.provider) {
      case 'ANTHROPIC':
        return new AnthropicProvider(apiKey)
      case 'OPENAI':
        return new OpenAIProvider(apiKey)
      case 'GOOGLE':
      case 'CUSTOM':
        throw new Error(`Provider ${row.provider} is reserved for a future release.`)
      default: {
        const _exhaustive: never = row.provider
        throw new Error(`Unhandled provider: ${_exhaustive}`)
      }
    }
  }

  /** True if both DEEP and FAST keys are configured for the org. */
  static async isFullyConfigured(orgId: string): Promise<boolean> {
    const count = await prisma.providerKey.count({ where: { orgId } })
    return count >= 2
  }
}

export class ProviderNotConfiguredError extends Error {
  constructor(
    public readonly orgId: string,
    public readonly kind: ProviderKind,
  ) {
    super(`No ${kind} provider key configured for org ${orgId}.`)
    this.name = 'ProviderNotConfiguredError'
  }
}
