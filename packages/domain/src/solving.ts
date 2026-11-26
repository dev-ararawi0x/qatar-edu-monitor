export const solveJobStatuses = ['queued', 'running', 'paused', 'completed', 'failed'] as const
export type SolveJobStatus = (typeof solveJobStatuses)[number]

export const pauseReasons = [
  'SESSION_EXPIRED',
  'MANUAL_INPUT_REQUIRED',
  'PARSER_MISMATCH',
  'POLICY_BLOCKED',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'LMS_ACCESS_DENIED',
  'AMBIGUOUS_REMOTE_WRITE',
  'WORKER_LEASE_EXPIRED',
] as const
export type PauseReason = (typeof pauseReasons)[number]

const transitions: Record<SolveJobStatus, readonly SolveJobStatus[]> = {
  queued: ['running'],
  running: ['completed', 'paused', 'failed', 'queued'],
  paused: ['queued'],
  completed: [],
  failed: ['queued'],
}

export function canTransitionSolveJob(from: SolveJobStatus, to: SolveJobStatus): boolean {
  return transitions[from].includes(to)
}

export function assertSolveJobTransition(from: SolveJobStatus, to: SolveJobStatus): void {
  if (!canTransitionSolveJob(from, to)) throw new Error(`Invalid solve job transition ${from}->${to}`)
}

export function isActiveSolveJob(status: SolveJobStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'paused'
}
