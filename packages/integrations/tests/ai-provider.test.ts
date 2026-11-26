import { describe, expect, it } from 'vitest'
import { validateAnswerForQuestion } from '@hallili/domain'
import { AiProviderError, OpenAiCompatibleDraftGenerator } from '../src/ai/openai-compatible-adapter'
import { RetryingAiDraftGenerator } from '../src/ai/retrying-ai-generator'

const question = { externalQuestionId: 'q', fingerprint: null, type: 'single_choice' as const, prompt: 'Pick', options: [{ id: 'a', label: 'A' }] }
function response(status: number, body: unknown, headers: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

describe('configured AI provider adapter', () => {
  it('parses structured output without exposing secrets', async () => {
    const adapter = new OpenAiCompatibleDraftGenerator({ baseUrl: 'https://provider.example', apiKey: 'secret-key', model: 'model', fetcher: async () => response(200, { choices: [{ message: { content: JSON.stringify({ answer: { kind: 'choice', selectedOptionIds: ['a'] }, explanation: 'why', confidence: 0.8 }) } }] }) as never })
    const result = await adapter.generate({ question, language: 'auto' })
    expect(result.answer).toEqual({ kind: 'choice', selectedOptionIds: ['a'] })
    expect(JSON.stringify(result)).not.toContain('secret-key')
  })

  it('classifies 429 with Retry-After and schema failures', async () => {
    const rateLimited = new OpenAiCompatibleDraftGenerator({ baseUrl: 'https://provider.example', apiKey: 'x', model: 'm', fetcher: async () => response(429, {}, { 'retry-after': '2' }) as never })
    await expect(rateLimited.generate({ question, language: 'auto' })).rejects.toMatchObject({ kind: 'rate_limited', retryAfterMs: 2000 })
    const invalid = new OpenAiCompatibleDraftGenerator({ baseUrl: 'https://provider.example', apiKey: 'x', model: 'm', fetcher: async () => response(200, { choices: [{ message: { content: '{"answer":null}' } }] }) as never })
    await expect(invalid.generate({ question, language: 'auto' })).rejects.toMatchObject({ kind: 'schema' })
  })
})

describe('retry and answer validation', () => {
  it('uses fallback only for eligible transient failures', async () => {
    let primaryCalls = 0
    const primary = { generate: async () => { primaryCalls += 1; throw new AiProviderError('unavailable', 'down') } }
    const fallback = { generate: async () => ({ answer: { kind: 'choice' as const, selectedOptionIds: ['a'] }, explanation: null, confidence: 0.5, provider: 'fake', model: 'fake' }) }
    const result = await new RetryingAiDraftGenerator(primary, fallback, 1).generate({ question, language: 'auto' })
    expect(result.provider).toBe('fake')
    expect(primaryCalls).toBe(1)
  })

  it('rejects invalid or out-of-range option values', () => {
    expect(validateAnswerForQuestion({ kind: 'choice', selectedOptionIds: ['missing'] }, question)).toBe(false)
    expect(validateAnswerForQuestion({ kind: 'choice', selectedOptionIds: ['a'] }, question)).toBe(true)
    expect(validateAnswerForQuestion({ kind: 'text', value: 'valid' }, question)).toBe(false)
  })
})
