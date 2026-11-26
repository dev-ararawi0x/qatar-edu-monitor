import { describe, expect, it } from 'vitest'
import { FakeLmsAdapter } from '../../src/lms/fake-lms-adapter'
import { LmsOutboundGuard } from '../../src/lms/outbound-guard'
import { normalizeSubjectsHtml } from '../../src/lms/normalizers'
import { subjectsFixtureHtml } from '../../src/lms/fixtures/catalog-fixtures'

describe('LmsOutboundGuard', () => {
  it('allows only HTTPS approved Qatar education hosts', () => {
    const guard = new LmsOutboundGuard()
    expect(guard.validateUrl('https://qeducation.edu.gov.qa/user_dashboard').hostname).toBe('qeducation.edu.gov.qa')
    expect(() => guard.validateUrl('http://qeducation.edu.gov.qa')).toThrow()
    expect(() => guard.validateUrl('https://evil.example/path')).toThrow()
    expect(() => guard.validateUrl('https://user:pass@qeducation.edu.gov.qa')).toThrow()
  })
})

describe('fixture-backed fake LMS adapter', () => {
  it('normalizes sanitized subject fixtures', () => {
    expect(normalizeSubjectsHtml(subjectsFixtureHtml)).toEqual([
      { externalId: 'SUBJ-MATH-7', name: 'Mathematics', gradeLabel: 'Grade 7', sectionLabel: 'A' },
      { externalId: 'SUBJ-SCI-7', name: 'Science', gradeLabel: 'Grade 7', sectionLabel: 'A' },
    ])
  })

  it('supports expired, blocked, timeout, and parser mismatch modes', async () => {
    const fake = new FakeLmsAdapter('expired')
    expect(await fake.validateSession('credential')).toEqual({ kind: 'expired' })
    fake.setMode('blocked')
    expect(await fake.validateSession('credential')).toEqual({ kind: 'blocked' })
    fake.setMode('timeout')
    expect(await fake.validateSession('credential')).toEqual({ kind: 'timeout' })
    fake.setMode('parser_mismatch')
    await expect(fake.listSubjects('credential')).rejects.toThrow('PARSER_MISMATCH')
  })

  it('rejects unknown structures instead of guessing', () => {
    expect(() => normalizeSubjectsHtml('<table></table>')).toThrow('PARSER_MISMATCH')
  })
})
