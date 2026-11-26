import type { LmsReadPort, LmsValidationResult } from '@hallili/application'
import { normalizeAssessmentsHtml, normalizeSubjectsHtml } from './normalizers'
import { assessmentsFixtureHtml, subjectsFixtureHtml } from './fixtures/catalog-fixtures'

export type FakeLmsMode = 'success' | 'expired' | 'blocked' | 'timeout' | 'parser_mismatch'

export class FakeLmsAdapter implements LmsReadPort {
  constructor(private mode: FakeLmsMode = 'success') {}
  setMode(mode: FakeLmsMode) { this.mode = mode }

  async validateSession(_credential: string): Promise<LmsValidationResult> {
    if (this.mode === 'success') return { kind: 'valid' }
    if (this.mode === 'parser_mismatch') return { kind: 'unknown' }
    return { kind: this.mode }
  }

  async listSubjects(_credential: string) {
    this.assertReadable()
    return normalizeSubjectsHtml(subjectsFixtureHtml)
  }

  async listAssessments(_credential: string, _subjectExternalId: string) {
    this.assertReadable()
    return normalizeAssessmentsHtml(assessmentsFixtureHtml)
  }

  private assertReadable() {
    if (this.mode === 'success') return
    if (this.mode === 'parser_mismatch') throw new Error('PARSER_MISMATCH')
    throw new Error(`LMS_${this.mode.toUpperCase()}`)
  }
}
