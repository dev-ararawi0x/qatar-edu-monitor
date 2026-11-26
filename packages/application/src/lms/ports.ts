import type { EncryptedCredentialMaterial, LmsConnectionSnapshot, LmsConnectionStatus, NormalizedQuestion } from '@hallili/domain'

export interface CredentialCipherPort {
  encrypt(plaintext: string, aad: string): Promise<EncryptedCredentialMaterial> | EncryptedCredentialMaterial
  decrypt(material: EncryptedCredentialMaterial, aad: string): Promise<string> | string
}

export interface StoredLmsConnection extends LmsConnectionSnapshot {
  encryptedCredential: EncryptedCredentialMaterial | null
}

export interface LmsCredentialRepositoryPort {
  findByUserId(userId: string): Promise<StoredLmsConnection | null>
  save(input: {
    userId: string
    encryptedCredential: EncryptedCredentialMaterial
    status: LmsConnectionStatus
  }): Promise<StoredLmsConnection>
  markValidated(input: {
    userId: string
    status: 'valid' | 'expired' | 'blocked' | 'unknown'
    validatedAt: Date
  }): Promise<void>
  revoke(userId: string, revokedAt: Date): Promise<void>
}

export type LmsValidationResult =
  | { kind: 'valid' }
  | { kind: 'expired' }
  | { kind: 'blocked' }
  | { kind: 'timeout' }
  | { kind: 'parser_mismatch' }
  | { kind: 'unknown' }

export interface LmsSubjectOutput {
  externalId: string
  name: string
  gradeLabel: string | null
  sectionLabel: string | null
}

export interface LmsAssessmentOutput {
  externalId: string
  title: string
  type: string | null
  dueAt: Date | null
  sourceStatus: string | null
  timedQuizStatus: 'yes' | 'no' | 'unknown'
  quizId: string | null
  resultsId: string | null
}

export interface LmsReadPort {
  validateSession(credential: string): Promise<LmsValidationResult>
  listSubjects(credential: string): Promise<LmsSubjectOutput[]>
  listAssessments(credential: string, subjectExternalId: string): Promise<LmsAssessmentOutput[]>
  fetchQuestionManifest?(credential: string, quizId: string, resultsId: string): Promise<NormalizedQuestion[]>
}
