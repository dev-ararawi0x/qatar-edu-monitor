import { describe, expect, it } from 'vitest'
import { assertSolveJobTransition, canTransitionSolveJob, pauseReasons } from '../src/solving'

describe('solve job state machine', () => {
  it('encodes the documented transition table', () => {
    expect(canTransitionSolveJob('queued', 'running')).toBe(true)
    expect(canTransitionSolveJob('running', 'paused')).toBe(true)
    expect(canTransitionSolveJob('running', 'completed')).toBe(true)
    expect(canTransitionSolveJob('paused', 'queued')).toBe(true)
    expect(canTransitionSolveJob('failed', 'queued')).toBe(true)
    expect(canTransitionSolveJob('queued', 'completed')).toBe(false)
    expect(canTransitionSolveJob('paused', 'running')).toBe(false)
    expect(canTransitionSolveJob('completed', 'queued')).toBe(false)
    expect(() => assertSolveJobTransition('paused', 'running')).toThrow()
  })

  it('uses typed pause reasons', () => {
    expect(pauseReasons).toContain('SESSION_EXPIRED')
    expect(pauseReasons).toContain('MANUAL_INPUT_REQUIRED')
    expect(pauseReasons).toContain('PARSER_MISMATCH')
  })
})
