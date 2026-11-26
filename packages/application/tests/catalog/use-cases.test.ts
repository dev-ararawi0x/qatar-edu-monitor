import { describe, expect, it } from 'vitest'
import { deriveAssessmentDisplayStatus } from '@hallili/domain'
import { ListAssessments, RefreshAssessments, RefreshSubjects } from '../../src/catalog/use-cases'
import type { CatalogRepositoryPort } from '../../src/catalog/ports'
import type { AssessmentSnapshot, SubjectSnapshot } from '@hallili/domain'

type SubjectInput = Parameters<CatalogRepositoryPort['upsertSubjects']>[1][number]
type AssessmentInput = Parameters<CatalogRepositoryPort['upsertAssessments']>[1][number]

function memoryCatalog(): CatalogRepositoryPort & { subjects: SubjectSnapshot[]; assessments: AssessmentSnapshot[] } {
  const state = { subjects: [] as SubjectSnapshot[], assessments: [] as AssessmentSnapshot[] }
  return {
    ...state,
    async listSubjects() { return state.subjects },
    async upsertSubjects(_connectionId: string, items: SubjectInput[]) {
      for (const item of items) {
        const existing = state.subjects.find((row) => row.externalId === item.externalId)
        if (existing) Object.assign(existing, item)
        else state.subjects.push({ id: `subject-${item.externalId}`, ...item, lastSyncedAt: item.syncedAt })
      }
      return state.subjects
    },
    async findOwnedSubject(userId: string, subjectId: string) {
      const row = state.subjects.find((item) => item.id === subjectId)
      return userId === 'user-1' && row ? { ...row, externalConnectionId: 'connection-1' } : null
    },
    async listAssessments(_userId: string, subjectId: string, dueOnly: boolean) {
      return state.assessments.filter((item) => item.subjectId === subjectId && (!dueOnly || item.dueAt))
    },
    async upsertAssessments(subjectId: string, items: AssessmentInput[]) {
      for (const item of items) {
        const existing = state.assessments.find((row) => row.subjectId === subjectId && row.externalId === item.externalId)
        if (existing) Object.assign(existing, item)
        else state.assessments.push({ id: `assessment-${item.externalId}`, subjectId, ...item, lastSyncedAt: item.syncedAt })
      }
      return state.assessments.filter((item) => item.subjectId === subjectId)
    },
    async upsertAttempts() { return undefined },
  }
}
const connectionRepo = { findByUserId: async () => ({ id: 'connection-1', userId: 'user-1', status: 'valid' as const, credentialExpiresAt: null, lastValidatedAt: null, lastRotatedAt: null, revokedAt: null, encryptedCredential: { ciphertext: new Uint8Array([1]), nonce: new Uint8Array(12), authTag: new Uint8Array(16), keyVersion: 1 } }), save: async () => { throw new Error('unused') }, markValidated: async () => undefined, revoke: async () => undefined }
const cipher = { encrypt: () => { throw new Error('unused') }, decrypt: () => 'credential' }
const actor = { userId: 'user-1' as never }

describe('catalog use cases', () => {
  it('upserts refreshed subjects rather than duplicating them', async () => {
    const catalog = memoryCatalog()
    const lms = { validateSession: async () => ({ kind: 'valid' as const }), listSubjects: async () => [{ externalId: 'S1', name: 'Math', gradeLabel: null, sectionLabel: null }], listAssessments: async () => [] }
    const useCase = new RefreshSubjects(catalog, connectionRepo, cipher, lms, { now: () => new Date('2030-01-01T00:00:00Z') })
    await useCase.execute(actor)
    const second = await useCase.execute(actor)
    expect(second.subjectCount).toBe(1)
    expect(catalog.subjects).toHaveLength(1)
  })

  it('keeps source status separate from derived display status', async () => {
    const catalog = memoryCatalog()
    catalog.subjects.push({ id: 'subject-1', externalId: 'S1', name: 'Math', gradeLabel: null, sectionLabel: null, lastSyncedAt: new Date() })
    const lms = { validateSession: async () => ({ kind: 'valid' as const }), listSubjects: async () => [], listAssessments: async () => [{ externalId: 'A1', title: 'Quiz', type: 'quiz', dueAt: new Date('2030-01-01T00:00:00Z'), sourceStatus: 'In progress', timedQuizStatus: 'unknown' as const, quizId: 'q', resultsId: 'r' }] }
    await new RefreshAssessments(catalog, connectionRepo, cipher, lms, { now: () => new Date() }).execute(actor, { subjectId: 'subject-1' })
    const list = await new ListAssessments(catalog).execute(actor, { subjectId: 'subject-1' })
    expect(list.items[0]?.sourceStatus).toBe('In progress')
    expect(list.items[0]?.displayStatus).toBe('IN_PROGRESS')
    expect(deriveAssessmentDisplayStatus({ sourceStatus: 'In progress', hasLocalDraft: false, confirmedSubmitted: false })).toBe('IN_PROGRESS')
  })

  it('does not fabricate data after parser mismatch', async () => {
    const catalog = memoryCatalog()
    const lms = { validateSession: async () => ({ kind: 'valid' as const }), listSubjects: async () => { throw new Error('PARSER_MISMATCH') }, listAssessments: async () => [] }
    await expect(new RefreshSubjects(catalog, connectionRepo, cipher, lms, { now: () => new Date() }).execute(actor)).rejects.toMatchObject({ code: 'UPSTREAM_FAILURE' })
    expect(catalog.subjects).toHaveLength(0)
  })
})
