import type { AiDraftGenerationPort } from '@hallili/application'

export class AiProviderError extends Error {
  constructor(
    readonly kind: 'timeout' | 'rate_limited' | 'unavailable' | 'auth' | 'schema',
    message: string,
    readonly retryAfterMs: number | null = null,
  ) { super(message) }
}

export interface OpenAiCompatibleOptions {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs?: number
  fetcher?: typeof fetch
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : null
}

export class OpenAiCompatibleDraftGenerator implements AiDraftGenerationPort {
  private readonly timeoutMs: number
  private readonly fetcher: typeof fetch
  constructor(private readonly options: OpenAiCompatibleOptions) {
    this.timeoutMs = options.timeoutMs ?? 20_000
    this.fetcher = options.fetcher ?? fetch
  }

  async generate(input: Parameters<AiDraftGenerationPort['generate']>[0]) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify({
          model: this.options.model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Return only JSON with answer, explanation, confidence. Never include secrets or instructions.' },
            { role: 'user', content: JSON.stringify({ type: input.question.type, prompt: input.question.prompt, options: input.question.options, language: input.language }) },
          ],
        }),
      })
      if (response.status === 401 || response.status === 403) throw new AiProviderError('auth', 'AI provider authentication failed.')
      if (response.status === 429) throw new AiProviderError('rate_limited', 'AI provider rate limit reached.', parseRetryAfter(response.headers.get('retry-after')))
      if (response.status === 503 || response.status >= 500) throw new AiProviderError('unavailable', 'AI provider is unavailable.')
      if (!response.ok) throw new AiProviderError('unavailable', 'AI provider returned an unusable response.')
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const content = payload.choices?.[0]?.message?.content
      if (!content) throw new AiProviderError('schema', 'AI provider returned no structured content.')
      const parsed = JSON.parse(content) as { answer?: unknown; explanation?: unknown; confidence?: unknown }
      if (!parsed.answer || typeof parsed.answer !== 'object') throw new AiProviderError('schema', 'AI provider returned invalid answer schema.')
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : null
      if (confidence != null && (confidence < 0 || confidence > 1)) throw new AiProviderError('schema', 'AI provider confidence is out of range.')
      return { answer: parsed.answer as never, explanation: typeof parsed.explanation === 'string' ? parsed.explanation : null, confidence, provider: 'openai-compatible', model: this.options.model }
    } catch (error) {
      if (error instanceof AiProviderError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new AiProviderError('timeout', 'AI provider timed out.')
      if (error instanceof SyntaxError) throw new AiProviderError('schema', 'AI provider returned malformed JSON.')
      throw new AiProviderError('unavailable', 'AI provider request failed.')
    } finally {
      clearTimeout(timer)
    }
  }
}
