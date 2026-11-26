const sensitiveKeyPattern = /cookie|token|csrf|auth|session|password|secret|api[_-]?key|credential/i
const sensitiveAssignmentPattern =
  /\b(cookie|token|csrf|password|secret|api[_-]?key|authorization)(=|:)\s*[^\s,;]+/gi

function redactString(value: string, force: boolean): string {
  if (force) return 'VALUES'
  return value.replace(sensitiveAssignmentPattern, (_match, key: string, separator: string) => {
    return `${key}${separator}VALUES`
  })
}

export function redactSecrets(value: unknown, force = false): unknown {
  if (typeof value === 'string') {
    return redactString(value, force)
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        redactSecrets(entry, sensitiveKeyPattern.test(key)),
      ]),
    )
  }
  return value
}

export function redactError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: redactSecrets(error.message) as string }
  }
  return { name: 'UnknownError', message: 'VALUES' }
}
