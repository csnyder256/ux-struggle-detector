import Anthropic from '@anthropic-ai/sdk'
import type {
  DeepRequest,
  DeepResponse,
  FastRequest,
  FastResponse,
  ModelProvider,
} from './index'

export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic' as const
  private client: Anthropic

  static DEFAULT_DEEP_MODEL = 'claude-opus-4-7'
  static DEFAULT_FAST_MODEL = 'claude-haiku-4-5-20251001'

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async deep(input: DeepRequest): Promise<DeepResponse> {
    const result = await this.client.messages.create({
      model: input.model ?? AnthropicProvider.DEFAULT_DEEP_MODEL,
      max_tokens: input.maxTokens ?? 8192,
      system: input.systemPrompt,
      messages: [{ role: 'user', content: input.userPrompt }],
      ...(input.jsonSchema
        ? {
            tools: [
              {
                name: 'output',
                description: 'Return the structured response.',
                input_schema: input.jsonSchema as Anthropic.Messages.Tool['input_schema'],
              },
            ],
            tool_choice: { type: 'tool' as const, name: 'output' },
          }
        : {}),
    })

    let content = ''
    let parsed: unknown | undefined
    for (const block of result.content) {
      if (block.type === 'text') content += block.text
      if (block.type === 'tool_use' && block.name === 'output') {
        parsed = block.input
        content = JSON.stringify(block.input)
      }
    }

    return {
      content,
      parsed,
      usage: {
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
      },
    }
  }

  async fast(input: FastRequest): Promise<FastResponse> {
    const result = await this.client.messages.create({
      model: input.model ?? AnthropicProvider.DEFAULT_FAST_MODEL,
      max_tokens: input.maxTokens ?? 512,
      system: input.systemPrompt,
      messages: [{ role: 'user', content: input.userPrompt }],
    })
    let content = ''
    for (const block of result.content) {
      if (block.type === 'text') content += block.text
    }
    return {
      content,
      usage: {
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
      },
    }
  }
}
