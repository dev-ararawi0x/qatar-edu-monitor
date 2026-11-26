import { describe, expect, it } from 'vitest'
import { GetJobQuestions, MarkDraftReviewed, UpdateDraft } from '../../src/drafts/use-cases'
import type { AnswerDraftSnapshot, DraftRepositoryPort, OwnedDraftSnapshot } from '../../src/drafts/ports'

function draft(version = 1): AnswerDraftSnapshot {
  const now = new Date()
  return { id: 'draft-1', jobQuestionId: 'question-row-1', answerPayload: { kind: 'choice', selectedOptionIds: ['a'] }, explanation: 'why', confidence: 0.8, remoteSaveStatus: 'not_enabled', origin: 'ai_generated', version, reviewedAt: null, updatedByUserId: null, createdAt: now, updatedAt: now }
}
const question = { externalQuestionId: 'q1', fingerprint: null, type: 'single_choice' as const, prompt: 'Pick', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }
function repo(mode: 'owner' | 'missing' | 'conflict' = 'owner'): DraftRepositoryPort {
  const current = draft()
  const owned: OwnedDraftSnapshot = { draft: current, question, jobId: 'job-1' }
  return {
    async listJobQuestions(userId) { return mode === 'missing' || userId !== 'user-1' ? null : [{ id: 'question-row-1', jobId: 'job-1', position: 1, questionType: 'single_choice', status: 'draft_saved', pauseReason: null, normalizedQuestion: question, draft: current }] },
    async findOwnedDraft(userId) { return mode === 'missing' || userId !== 'user-1' ? null : owned },
    async updateDraft(input) { return mode === 'conflict' ? 'version_conflict' : { ...current, answerPayload: input.answer, version: input.expectedVersion + 1, origin: 'edited' as const, updatedByUserId: input.userId } },
    async markReviewed(input) { return mode === 'conflict' ? 'version_conflict' : { ...current, reviewedAt: input.now } },
  }
}
const actor = { userId: 'user-1' as never }

describe('draft review use cases', () => {
  it('authorizes job ownership before exposing questions and drafts', async () => {
    const result = await new GetJobQuestions(repo()).execute(actor, 'job-1')
    expect(result.items[0]?.draft?.id).toBe('draft-1')
    await expect(new GetJobQuestions(repo()).execute({ userId: 'other' as never }, 'job-1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('increments versions on valid edits and appends a revision through the repository port', async () => {
    const result = await new UpdateDraft(repo(), { now: () => new Date() }).execute(actor, { draftId: 'draft-1', expectedVersion: 1, answer: { kind: 'choice', selectedOptionIds: ['b'] } })
    expect(result.draft.version).toBe(2)
    expect(result.draft.answer).toEqual({ kind: 'choice', selectedOptionIds: ['b'] })
  })

  it('returns version conflict for stale expected versions', async () => {
    await expect(new UpdateDraft(repo('conflict'), { now: () => new Date() }).execute(actor, { draftId: 'draft-1', expectedVersion: 1, answer: { kind: 'choice', selectedOptionIds: ['a'] } })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
  })

  it('rejects out-of-range answers without persisting a guess', async () => {
    await expect(new UpdateDraft(repo(), { now: () => new Date() }).execute(actor, { draftId: 'draft-1', expectedVersion: 1, answer: { kind: 'choice', selectedOptionIds: ['not-an-option'] } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('marks only the exact current version reviewed', async () => {
    const result = await new MarkDraftReviewed(repo(), { now: () => new Date('2030-01-01T00:00:00Z') }).execute(actor, { draftId: 'draft-1', expectedVersion: 1 })
    expect(result.draft.reviewedAt).toBe('2030-01-01T00:00:00.000Z')
  })
})
