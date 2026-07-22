import OpenAI from 'openai'
import type {
  DeepRequest,
  DeepResponse,
  FastRequest,
  FastResponse,
  ModelProvider,
} from './index'

export class OpenAIProvider implements ModelProvider {
  readonly id = 'openai' as const
  private client: OpenAI

  static DEFAULT_DEEP_MODEL = 'gpt-4o'
  static DEFAULT_FAST_MODEL = 'gpt-4o-mini'

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey })
  }

  async deep(input: DeepRequest): Promise<DeepResponse> {
    const result = await this.client.chat.completions.create({
      model: input.model ?? OpenAIProvider.DEFAULT_DEEP_MODEL,
      max_tokens: input.maxTokens ?? 8192,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt },
      ],
      ...(input.jsonSchema
        ? {
            response_format: {
              type: 'json_schema' as const,
              json_schema: {
                name: 'output',
                schema: input.jsonSchema,
                strict: false,
              },
            },
          }
        : {}),
    })

    const content = result.choices[0]?.message?.content ?? ''
    let parsed: unknown | undefined
    if (input.jsonSchema && content) {
      try {
        parsed = JSON.parse(content)
      } catch {
        // Leave parsed undefined; caller can decide.
      }
    }

    return {
      content,
      parsed,
      usage: {
        inputTokens: result.usage?.prompt_tokens ?? 0,
        outputTokens: result.usage?.completion_tokens ?? 0,
      },
    }
  }

  async fast(input: FastRequest): Promise<FastResponse> {
    const result = await this.client.chat.completions.create({
      model: input.model ?? OpenAIProvider.DEFAULT_FAST_MODEL,
      max_tokens: input.maxTokens ?? 512,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt },
      ],
    })
    return {
      content: result.choices[0]?.message?.content ?? '',
      usage: {
        inputTokens: result.usage?.prompt_tokens ?? 0,
        outputTokens: result.usage?.completion_tokens ?? 0,
      },
    }
  }
}
