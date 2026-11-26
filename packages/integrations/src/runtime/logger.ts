import type { LoggerPort } from '@hallili/application'
import { redactSecrets } from './redaction'

function write(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown>) {
  const line = JSON.stringify({
    level,
    event,
    time: new Date().toISOString(),
    ...(redactSecrets(fields) as Record<string, unknown>),
  })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export function createSecretSafeLogger(scope: string): LoggerPort {
  return {
    info(event, fields = {}) {
      write('info', event, { scope, ...fields })
    },
    warn(event, fields = {}) {
      write('warn', event, { scope, ...fields })
    },
    error(event, fields = {}) {
      write('error', event, { scope, ...fields })
    },
  }
}
