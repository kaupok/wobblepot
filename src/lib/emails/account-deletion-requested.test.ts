import { describe, it, expect, vi } from 'vitest'
import { generateAccountDeletionRequestedEmail } from './account-deletion-requested'

// Mock the env module (mirrors reset-password.test.ts)
vi.mock('@/lib/env', () => ({
  serverEnv: {
    NEXT_PUBLIC_APP_NAME: 'TestApp',
  },
}))

describe('generateAccountDeletionRequestedEmail', () => {
  // 2026-07-05T03:00:00Z — fixed UTC instant so the formatted date is stable.
  const purgeDate = new Date('2026-07-05T03:00:00.000Z')
  const recoveryEmail = 'privacy@wobblepot.com'

  it('returns object with subject, html, and text', () => {
    const result = generateAccountDeletionRequestedEmail({ purgeDate, recoveryEmail })

    expect(result).toHaveProperty('subject')
    expect(result).toHaveProperty('html')
    expect(result).toHaveProperty('text')
  })

  it('puts the app brand and formatted purge date in the subject', () => {
    const result = generateAccountDeletionRequestedEmail({ purgeDate, recoveryEmail })

    expect(result.subject).toBe('Your TestApp account will be deleted on 5 July 2026')
  })

  it('formats the purge date in UTC regardless of host timezone', () => {
    // 23:30Z would roll to the next local day in positive-offset zones; UTC
    // formatting must keep it on the 5th.
    const lateDay = new Date('2026-07-05T23:30:00.000Z')
    const result = generateAccountDeletionRequestedEmail({ purgeDate: lateDay, recoveryEmail })

    expect(result.subject).toContain('5 July 2026')
    expect(result.html).toContain('5 July 2026')
  })

  it('states the purge date in HTML and plain text', () => {
    const result = generateAccountDeletionRequestedEmail({ purgeDate, recoveryEmail })

    expect(result.html).toContain('5 July 2026')
    expect(result.text).toContain('5 July 2026')
  })

  it('explains how to cancel via the recovery email', () => {
    const result = generateAccountDeletionRequestedEmail({ purgeDate, recoveryEmail })

    expect(result.html).toContain(recoveryEmail)
    expect(result.html).toContain('Cancel deletion')
    expect(result.text).toContain(recoveryEmail)
    expect(result.text.toLowerCase()).toContain('cancel')
  })

  it('signs off with the legal entity name (Honkadori OÜ), not the brand only', () => {
    const result = generateAccountDeletionRequestedEmail({ purgeDate, recoveryEmail })

    expect(result.html).toContain('Honkadori OÜ')
    expect(result.text).toContain('Honkadori OÜ')
  })

  it('uses the Wobblepot brand (app name) in the body, not the legal name', () => {
    const result = generateAccountDeletionRequestedEmail({ purgeDate, recoveryEmail })

    expect(result.html).toContain('TestApp')
    expect(result.text).toContain('TestApp')
  })
})
