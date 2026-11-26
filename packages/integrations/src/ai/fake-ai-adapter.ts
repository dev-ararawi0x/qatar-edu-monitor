import type { AiDraftGenerationPort } from '@hallili/application'

export class FakeAiDraftGenerator implements AiDraftGenerationPort {
  async generate({ question }: Parameters<AiDraftGenerationPort['generate']>[0]) {
    if (question.type === 'single_choice' || question.type === 'multiple_choice') {
      const first = question.options[0]
      if (!first) throw new Error('AI_SCHEMA_INVALID')
      return { answer: { kind: 'choice' as const, selectedOptionIds: [first.id] }, explanation: 'Fixture-generated draft for local review.', confidence: 0.75, provider: 'fake', model: 'fake-v1' }
    }
    if (question.type === 'true_false') return { answer: { kind: 'boolean' as const, value: true }, explanation: 'Fixture-generated draft for local review.', confidence: 0.7, provider: 'fake', model: 'fake-v1' }
    if (question.type === 'text') return { answer: { kind: 'text' as const, value: 'Fixture draft answer requiring student review.' }, explanation: 'Fixture-generated draft for local review.', confidence: 0.7, provider: 'fake', model: 'fake-v1' }
    throw new Error('MANUAL_INPUT_REQUIRED')
  }
}
