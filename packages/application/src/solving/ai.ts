import type { AnswerPayload, NormalizedQuestion } from '@hallili/domain'

export interface AiDraftCandidate {
  answer: AnswerPayload
  explanation: string | null
  confidence: number | null
  provider: string
  model: string
}

export interface AiDraftGenerationPort {
  generate(input: { question: NormalizedQuestion; language: 'auto' | 'ar' | 'en' }): Promise<AiDraftCandidate>
}
