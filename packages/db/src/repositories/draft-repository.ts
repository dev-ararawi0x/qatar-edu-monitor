import type { AnswerDraftSnapshot, DraftRepositoryPort, JobQuestionDraftSnapshot, OwnedDraftSnapshot } from '@hallili/application'
import type { AnswerPayload, NormalizedQuestion } from '@hallili/domain'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { HalliliDatabase } from '../client'
import { answerDrafts, draftRevisions } from '../schema/drafts'
import { jobQuestions, solveJobs } from '../schema/solving'

type DraftRow = typeof answerDrafts.$inferSelect

function draft(row: DraftRow): AnswerDraftSnapshot {
  return {
    id: row.id,
    jobQuestionId: row.jobQuestionId,
    answerPayload: row.answerPayload as AnswerPayload,
    explanation: row.explanation,
    confidence: row.confidence == null ? null : Number(row.confidence),
    remoteSaveStatus: row.remoteSaveStatus as AnswerDraftSnapshot['remoteSaveStatus'],
    origin: row.origin as AnswerDraftSnapshot['origin'],
    version: row.version,
    reviewedAt: row.reviewedAt,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class DrizzleDraftRepository implements DraftRepositoryPort {
  constructor(private readonly db: HalliliDatabase) {}

  async listJobQuestions(userId: string, jobId: string) {
    const owned = await this.db.select({ id: solveJobs.id }).from(solveJobs).where(and(eq(solveJobs.id, jobId), eq(solveJobs.userId, userId))).limit(1)
    if (!owned[0]) return null
    const rows = await this.db.select({ question: jobQuestions, draft: answerDrafts }).from(jobQuestions).leftJoin(answerDrafts, eq(answerDrafts.jobQuestionId, jobQuestions.id)).where(eq(jobQuestions.jobId, jobId)).orderBy(asc(jobQuestions.position))
    return rows.map((row): JobQuestionDraftSnapshot => ({
      id: row.question.id,
      jobId: row.question.jobId,
      position: row.question.position,
      questionType: row.question.questionType,
      status: row.question.status,
      pauseReason: row.question.pauseReason,
      normalizedQuestion: row.question.normalizedQuestion as NormalizedQuestion | null,
      draft: row.draft ? draft(row.draft) : null,
    }))
  }

  async findOwnedDraft(userId: string, draftId: string): Promise<OwnedDraftSnapshot | null> {
    const rows = await this.db.select({ draft: answerDrafts, question: jobQuestions, job: solveJobs }).from(answerDrafts).innerJoin(jobQuestions, eq(answerDrafts.jobQuestionId, jobQuestions.id)).innerJoin(solveJobs, eq(jobQuestions.jobId, solveJobs.id)).where(and(eq(answerDrafts.id, draftId), eq(solveJobs.userId, userId))).limit(1)
    const row = rows[0]
    return row ? { draft: draft(row.draft), question: row.question.normalizedQuestion as NormalizedQuestion | null, jobId: row.job.id } : null
  }

  async updateDraft(input: { userId: string; draftId: string; expectedVersion: number; answer: AnswerPayload; now: Date }) {
    return this.db.transaction(async (tx) => {
      const rows = await tx.update(answerDrafts).set({ answerPayload: input.answer, origin: 'edited', version: input.expectedVersion + 1, updatedByUserId: input.userId, updatedAt: input.now }).where(and(eq(answerDrafts.id, input.draftId), eq(answerDrafts.version, input.expectedVersion))).returning()
      const row = rows[0]
      if (!row) return 'version_conflict' as const
      await tx.insert(draftRevisions).values({ draftId: input.draftId, version: input.expectedVersion + 1, answerPayload: input.answer, actorType: 'user', actorUserId: input.userId, changeReason: 'user_edit', createdAt: input.now })
      return draft(row)
    })
  }

  async markReviewed(input: { userId: string; draftId: string; expectedVersion: number; now: Date }) {
    const rows = await this.db.update(answerDrafts).set({ reviewedAt: input.now, updatedByUserId: input.userId, updatedAt: input.now }).where(and(eq(answerDrafts.id, input.draftId), eq(answerDrafts.version, input.expectedVersion))).returning()
    return rows[0] ? draft(rows[0]) : 'version_conflict'
  }
}
