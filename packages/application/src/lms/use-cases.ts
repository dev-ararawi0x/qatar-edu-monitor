import type { LmsConnectionStatus } from '@hallili/domain'
import { ApplicationError, type ActorContext, type ClockPort, type IdGenerator } from '../index'
import type { CredentialCipherPort, LmsCredentialRepositoryPort, LmsReadPort } from './ports'

export interface SaveLmsCredentialInput {
  cookieValue: string
}

export class SaveLmsCredential {
  constructor(
    private readonly repository: LmsCredentialRepositoryPort,
    private readonly cipher: CredentialCipherPort,
    private readonly ids: IdGenerator,
  ) {}

  async execute(actor: ActorContext, input: SaveLmsCredentialInput) {
    const cookieValue = input.cookieValue.trim()
    if (!cookieValue) throw new ApplicationError('VALIDATION_ERROR', 'The LMS credential is required.', 400)
    const existing = await this.repository.findByUserId(actor.userId)
    const connectionId = existing?.id ?? this.ids.uuid()
    const encryptedCredential = await this.cipher.encrypt(cookieValue, `${actor.userId}:${connectionId}`)
    const saved = await this.repository.save({
      userId: actor.userId,
      encryptedCredential,
      status: 'unverified',
    })
    return toConnectionDto(saved)
  }
}

export class GetLmsConnection {
  constructor(private readonly repository: LmsCredentialRepositoryPort) {}
  async execute(actor: ActorContext) {
    const connection = await this.repository.findByUserId(actor.userId)
    return { connection: connection ? toConnectionDto(connection) : null }
  }
}

export class RevokeLmsConnection {
  constructor(
    private readonly repository: LmsCredentialRepositoryPort,
    private readonly clock: ClockPort,
  ) {}
  async execute(actor: ActorContext) {
    await this.repository.revoke(actor.userId, this.clock.now())
  }
}

export class ValidateLmsConnection {
  constructor(
    private readonly repository: LmsCredentialRepositoryPort,
    private readonly cipher: CredentialCipherPort,
    private readonly lms: LmsReadPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: ActorContext) {
    const connection = await this.repository.findByUserId(actor.userId)
    if (!connection?.encryptedCredential || connection.status === 'revoked') {
      throw new ApplicationError('NOT_FOUND', 'No active LMS connection was found.', 404)
    }
    const credential = await this.cipher.decrypt(
      connection.encryptedCredential,
      `${connection.userId}:${connection.id}`,
    )
    const result = await this.lms.validateSession(credential)
    const status = validationStatus(result.kind)
    const checkedAt = this.clock.now()
    await this.repository.markValidated({ userId: actor.userId, status, validatedAt: checkedAt })
    return {
      status,
      checkedAt: checkedAt.toISOString(),
      message: validationMessage(status),
    }
  }
}

function validationStatus(kind: string): 'valid' | 'expired' | 'blocked' | 'unknown' {
  if (kind === 'valid') return 'valid'
  if (kind === 'expired') return 'expired'
  if (kind === 'blocked') return 'blocked'
  return 'unknown'
}

function validationMessage(status: LmsConnectionStatus): string {
  if (status === 'valid') return 'The LMS connection is valid.'
  if (status === 'expired') return 'The LMS session has expired. Reconnect it and try again.'
  if (status === 'blocked') return 'The LMS denied access. Hallili will not bypass this block.'
  return 'The LMS connection state could not be determined safely.'
}

function toConnectionDto(connection: {
  status: LmsConnectionStatus
  lastValidatedAt: Date | null
  credentialExpiresAt: Date | null
  lastRotatedAt: Date | null
}) {
  return {
    status: connection.status,
    lastValidatedAt: connection.lastValidatedAt?.toISOString() ?? null,
    credentialExpiresAt: connection.credentialExpiresAt?.toISOString() ?? null,
    lastRotatedAt: connection.lastRotatedAt?.toISOString() ?? null,
  }
}
