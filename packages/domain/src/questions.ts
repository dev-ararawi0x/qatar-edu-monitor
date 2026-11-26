export const questionTypes = ['single_choice', 'multiple_choice', 'true_false', 'text', 'file_upload'] as const
export type QuestionType = (typeof questionTypes)[number]

export interface QuestionOption {
  id: string
  label: string
}

export interface NormalizedQuestion {
  externalQuestionId: string | null
  fingerprint: string | null
  type: QuestionType
  prompt: string
  options: QuestionOption[]
}

export type AnswerPayload =
  | { kind: 'choice'; selectedOptionIds: string[] }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'text'; value: string }

export function validateAnswerForQuestion(answer: AnswerPayload, question: Pick<NormalizedQuestion, 'type' | 'options'>): boolean {
  if (answer.kind === 'choice') {
    if (question.type !== 'single_choice' && question.type !== 'multiple_choice') return false
    if (answer.selectedOptionIds.length === 0) return false
    if (question.type === 'single_choice' && answer.selectedOptionIds.length !== 1) return false
    const allowed = new Set(question.options.map((option) => option.id))
    return answer.selectedOptionIds.every((id) => allowed.has(id))
  }
  if (answer.kind === 'boolean') return question.type === 'true_false'
  if (answer.kind === 'text') return question.type === 'text' && answer.value.trim().length > 0 && answer.value.length <= 5000
  return false
}
