import type { AiDraftGenerationPort } from '@hallili/application'
import { AiProviderError } from './openai-compatible-adapter'

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)) }

export class RetryingAiDraftGenerator implements AiDraftGenerationPort {
  constructor(
    private readonly primary: AiDraftGenerationPort,
    private readonly fallback: AiDraftGenerationPort | null = null,
    private readonly maxAttempts = 2,
  ) {}

  async generate(input: Parameters<AiDraftGenerationPort['generate']>[0]) {
    let lastError: unknown = null
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try { return await this.primary.generate(input) } catch (error) {
        lastError = error
        if (!(error instanceof AiProviderError) || error.kind === 'auth' || error.kind === 'schema') break
        if (attempt < this.maxAttempts) await sleep(error.retryAfterMs ?? 250 * attempt)
      }
    }
    if (this.fallback && lastError instanceof AiProviderError && lastError.kind !== 'auth' && lastError.kind !== 'schema') {
      return this.fallback.generate(input)
    }
    throw lastError instanceof Error ? lastError : new Error('PROVIDER_UNAVAILABLE')
  }
}
