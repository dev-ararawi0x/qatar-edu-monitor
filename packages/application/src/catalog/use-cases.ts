import { deriveAssessmentDisplayStatus } from '@hallili/domain'
import { ApplicationError, type ActorContext, type ClockPort } from '../index'
import type { CredentialCipherPort, LmsCredentialRepositoryPort, LmsReadPort } from '../lms/ports'
import type { CatalogRepositoryPort } from './ports'

function subjectDto(row: { id: string; externalId: string; name: string; gradeLabel: string | null; sectionLabel: string | null; lastSyncedAt: Date }) {
  return { id: row.id, externalId: row.externalId, name: row.name, gradeLabel: row.gradeLabel, sectionLabel: row.sectionLabel, lastSyncedAt: row.lastSyncedAt.toISOString() }
}
function assessmentDto(row: { id: string; externalId: string; title: string; type: string | null; dueAt: Date | null; sourceStatus: string | null; timedQuizStatus: 'yes'|'no'|'unknown'; lastSyncedAt: Date }) {
  return { id: row.id, externalId: row.externalId, title: row.title, type: row.type, dueAt: row.dueAt?.toISOString() ?? null, sourceStatus: row.sourceStatus, timedQuizStatus: row.timedQuizStatus, displayStatus: deriveAssessmentDisplayStatus({ sourceStatus: row.sourceStatus, hasLocalDraft: false, confirmedSubmitted: false }), lastSyncedAt: row.lastSyncedAt.toISOString() }
}

async function credentialForConnection(
  actor: ActorContext,
  connections: LmsCredentialRepositoryPort,
  cipher: CredentialCipherPort,
) {
  const connection = await connections.findByUserId(actor.userId)
  if (!connection?.encryptedCredential || connection.status === 'revoked') throw new ApplicationError('NOT_FOUND', 'No active LMS connection was found.', 404)
  const credential = await cipher.decrypt(connection.encryptedCredential, `${connection.userId}:${connection.id}`)
  return { connection, credential }
}

function mapParserError(error: unknown): never {
  if (error instanceof Error && error.message.includes('PARSER_MISMATCH')) {
    throw new ApplicationError('UPSTREAM_FAILURE', 'The LMS page structure could not be understood safely.', 502)
  }
  throw error
}

export class ListSubjects {
  constructor(private readonly catalog: CatalogRepositoryPort) {}
  async execute(actor: ActorContext) {
    const items = await this.catalog.listSubjects(actor.userId)
    return { items: items.map(subjectDto), nextCursor: null }
  }
}

export class RefreshSubjects {
  constructor(private readonly catalog: CatalogRepositoryPort, private readonly connections: LmsCredentialRepositoryPort, private readonly cipher: CredentialCipherPort, private readonly lms: LmsReadPort, private readonly clock: ClockPort) {}
  async execute(actor: ActorContext) {
    const { connection, credential } = await credentialForConnection(actor, this.connections, this.cipher)
    const now = this.clock.now()
    try {
      const source = await this.lms.listSubjects(credential)
      const items = await this.catalog.upsertSubjects(connection.id, source.map((item) => ({ ...item, syncedAt: now })))
      return { refreshedAt: now.toISOString(), subjectCount: items.length, items: items.map(subjectDto) }
    } catch (error) { mapParserError(error) }
  }
}

export class ListAssessments {
  constructor(private readonly catalog: CatalogRepositoryPort) {}
  async execute(actor: ActorContext, input: { subjectId: string; dueOnly?: boolean }) {
    const subject = await this.catalog.findOwnedSubject(actor.userId, input.subjectId)
    if (!subject) throw new ApplicationError('NOT_FOUND', 'The requested subject was not found.', 404)
    const items = await this.catalog.listAssessments(actor.userId, input.subjectId, input.dueOnly ?? true)
    return { items: items.map(assessmentDto), nextCursor: null }
  }
}

export class RefreshAssessments {
  constructor(private readonly catalog: CatalogRepositoryPort, private readonly connections: LmsCredentialRepositoryPort, private readonly cipher: CredentialCipherPort, private readonly lms: LmsReadPort, private readonly clock: ClockPort) {}
  async execute(actor: ActorContext, input: { subjectId: string }) {
    const subject = await this.catalog.findOwnedSubject(actor.userId, input.subjectId)
    if (!subject) throw new ApplicationError('NOT_FOUND', 'The requested subject was not found.', 404)
    const { credential } = await credentialForConnection(actor, this.connections, this.cipher)
    const now = this.clock.now()
    try {
      const source = await this.lms.listAssessments(credential, subject.externalId)
      const items = await this.catalog.upsertAssessments(input.subjectId, source.map((item) => ({ externalId: item.externalId, title: item.title, type: item.type, dueAt: item.dueAt, sourceStatus: item.sourceStatus, timedQuizStatus: item.timedQuizStatus, syncedAt: now })))
      const byExternalId = new Map(items.map((item) => [item.externalId, item.id]))
      await this.catalog.upsertAttempts(actor.userId, source.flatMap((item) => {
        const assessmentId = byExternalId.get(item.externalId)
        return assessmentId && item.quizId && item.resultsId ? [{ assessmentId, lmsQuizId: item.quizId, lmsResultsId: item.resultsId, timedQuizStatus: item.timedQuizStatus, sourceStatus: item.sourceStatus, seenAt: now }] : []
      }))
      return { refreshedAt: now.toISOString(), assessmentCount: items.length, items: items.map(assessmentDto) }
    } catch (error) { mapParserError(error) }
  }
}
