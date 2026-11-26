import { validateAnswerForQuestion, type AnswerPayload } from '@hallili/domain'
import { ApplicationError, type ActorContext, type ClockPort } from '../index'
import type { AnswerDraftSnapshot, DraftRepositoryPort } from './ports'

function draftDto(draft: AnswerDraftSnapshot) {
  return { id: draft.id, answer: draft.answerPayload, explanation: draft.explanation, confidence: draft.confidence, version: draft.version, reviewedAt: draft.reviewedAt?.toISOString() ?? null, remoteSaveStatus: draft.remoteSaveStatus }
}

export class GetJobQuestions {
  constructor(private readonly drafts: DraftRepositoryPort) {}
  async execute(actor: ActorContext, jobId: string) {
    const rows = await this.drafts.listJobQuestions(actor.userId, jobId)
    if (!rows) throw new ApplicationError('NOT_FOUND', 'The requested job was not found.', 404)
    return { items: rows.map((row) => ({ id: row.id, position: row.position, type: row.questionType, status: row.status, pauseReason: row.pauseReason, prompt: row.normalizedQuestion?.prompt ?? null, options: row.normalizedQuestion?.options ?? [], draft: row.draft ? draftDto(row.draft) : null })) }
  }
}

export class UpdateDraft {
  constructor(private readonly drafts: DraftRepositoryPort, private readonly clock: ClockPort) {}
  async execute(actor: ActorContext, input: { draftId: string; expectedVersion: number; answer: AnswerPayload }) {
    const owned = await this.drafts.findOwnedDraft(actor.userId, input.draftId)
    if (!owned) throw new ApplicationError('NOT_FOUND', 'The requested draft was not found.', 404)
    if (!owned.question || !validateAnswerForQuestion(input.answer, owned.question)) throw new ApplicationError('VALIDATION_ERROR', 'The answer is not valid for this question.', 400)
    const updated = await this.drafts.updateDraft({ userId: actor.userId, draftId: input.draftId, expectedVersion: input.expectedVersion, answer: input.answer, now: this.clock.now() })
    if (updated === 'version_conflict') throw new ApplicationError('VERSION_CONFLICT', 'This draft changed since you loaded it. Reload the latest version.', 409)
    if (!updated) throw new ApplicationError('NOT_FOUND', 'The requested draft was not found.', 404)
    return { draft: draftDto(updated) }
  }
}

export class MarkDraftReviewed {
  constructor(private readonly drafts: DraftRepositoryPort, private readonly clock: ClockPort) {}
  async execute(actor: ActorContext, input: { draftId: string; expectedVersion: number }) {
    const owned = await this.drafts.findOwnedDraft(actor.userId, input.draftId)
    if (!owned) throw new ApplicationError('NOT_FOUND', 'The requested draft was not found.', 404)
    const updated = await this.drafts.markReviewed({ userId: actor.userId, draftId: input.draftId, expectedVersion: input.expectedVersion, now: this.clock.now() })
    if (updated === 'version_conflict') throw new ApplicationError('VERSION_CONFLICT', 'This draft changed since you loaded it. Reload the latest version.', 409)
    if (!updated) throw new ApplicationError('NOT_FOUND', 'The requested draft was not found.', 404)
    return { draft: draftDto(updated) }
  }
}
