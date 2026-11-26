import type { AnswerPayload, NormalizedQuestion } from '@hallili/domain'

export interface AnswerDraftSnapshot {
  id: string
  jobQuestionId: string
  answerPayload: AnswerPayload
  explanation: string | null
  confidence: number | null
  remoteSaveStatus: 'not_enabled'|'not_started'|'pending'|'saved'|'ambiguous'|'failed'
  origin: 'ai_generated'|'user_entered'|'edited'
  version: number
  reviewedAt: Date | null
  updatedByUserId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface JobQuestionDraftSnapshot {
  id: string
  jobId: string
  position: number
  questionType: string | null
  status: string
  pauseReason: string | null
  normalizedQuestion: NormalizedQuestion | null
  draft: AnswerDraftSnapshot | null
}

export interface OwnedDraftSnapshot {
  draft: AnswerDraftSnapshot
  question: NormalizedQuestion | null
  jobId: string
}

export interface DraftRepositoryPort {
  listJobQuestions(userId: string, jobId: string): Promise<JobQuestionDraftSnapshot[] | null>
  findOwnedDraft(userId: string, draftId: string): Promise<OwnedDraftSnapshot | null>
  updateDraft(input: {
    userId: string
    draftId: string
    expectedVersion: number
    answer: AnswerPayload
    now: Date
  }): Promise<AnswerDraftSnapshot | 'version_conflict' | null>
  markReviewed(input: {
    userId: string
    draftId: string
    expectedVersion: number
    now: Date
  }): Promise<AnswerDraftSnapshot | 'version_conflict' | null>
}
