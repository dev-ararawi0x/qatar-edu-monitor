import type { UserId } from '@hallili/domain'

export interface ActorContext {
  readonly userId: UserId
}

export interface ClockPort {
  now(): Date
}

export interface IdGenerator {
  uuid(): string
}

export interface LoggerPort {
  info(event: string, fields?: Record<string, unknown>): void
  warn(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
}

export class ApplicationError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'ApplicationError'
    this.code = code
    this.status = status
  }
}

export function requireActor(actor: ActorContext | null): ActorContext {
  if (!actor) {
    throw new ApplicationError('UNAUTHENTICATED', 'Authentication is required.', 401)
  }
  return actor
}

export * from './ownership'

export * from './lms/ports'
export * from './lms/use-cases'
export * from './catalog/ports'
export * from './catalog/use-cases'
export * from './solving/ports'
export * from './solving/use-cases'
export * from './solving/ai'
export * from './solving/processing'
export * from './solving/process-solve-job'
export * from './solving/resume-solve-job'
export * from './drafts/ports'
export * from './drafts/use-cases'
export * from './notifications/ports'
export * from './notifications/use-cases'
