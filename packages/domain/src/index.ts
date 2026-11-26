export type Brand<T, TBrand> = T & { readonly __brand: TBrand }

export type UserId = Brand<string, 'UserId'>
export type Uuid = Brand<string, 'Uuid'>

export class DomainError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}

export function assertNever(value: never): never {
  throw new DomainError('UNREACHABLE_VARIANT', `Unhandled variant: ${String(value)}`)
}

export * from './lms'
export * from './catalog'
