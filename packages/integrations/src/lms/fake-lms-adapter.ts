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

  async fetchQuestionManifest(_credential: string, _quizId: string, _resultsId: string) {
    this.assertReadable()
    return [
      { externalQuestionId: 'question-1', fingerprint: null, type: 'single_choice' as const, prompt: 'What is 2 + 2?', options: [{ id: 'a', label: '3' }, { id: 'b', label: '4' }] },
      { externalQuestionId: 'question-2', fingerprint: null, type: 'text' as const, prompt: 'Explain photosynthesis briefly.', options: [] },
    ]
  }

  private assertReadable() {
    if (this.mode === 'success') return
    if (this.mode === 'parser_mismatch') throw new Error('PARSER_MISMATCH')
    throw new Error(`LMS_${this.mode.toUpperCase()}`)
  }
}
