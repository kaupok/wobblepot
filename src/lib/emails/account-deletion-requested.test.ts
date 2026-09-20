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

describe('generateAccountDeletionRequestedEmail — locale (HON-513)', () => {
  const purgeDate = new Date('2026-07-05T03:00:00.000Z')
  const recoveryEmail = 'privacy@wobblepot.com'

  it('defaults to English when no locale is passed', () => {
    const omitted = generateAccountDeletionRequestedEmail({ purgeDate, recoveryEmail })
    const explicit = generateAccountDeletionRequestedEmail({
      purgeDate,
      recoveryEmail,
      locale: 'en',
    })

    expect(omitted).toEqual(explicit)
  })

  it('sets <html lang> from the resolved locale', () => {
    expect(
      generateAccountDeletionRequestedEmail({ purgeDate, recoveryEmail, locale: 'en' }).html,
    ).toContain('<html lang="en">')
    expect(
      generateAccountDeletionRequestedEmail({ purgeDate, recoveryEmail, locale: 'et' }).html,
    ).toContain('<html lang="et">')
  })

  it('returns a different subject per locale', () => {
    const en = generateAccountDeletionRequestedEmail({ purgeDate, recoveryEmail, locale: 'en' })
    const et = generateAccountDeletionRequestedEmail({ purgeDate, recoveryEmail, locale: 'et' })

    expect(en.subject).toBe('Your TestApp account will be deleted on 5 July 2026')
    expect(et.subject).toBe('Sinu TestApp konto kustutatakse kuupäeval 5. juuli 2026')
    expect(et.subject).not.toBe(en.subject)
  })

  it('formats the purge date in the Estonian style, still in UTC', () => {
    // 23:30Z would roll to the next local day in positive-offset zones.
    const lateDay = new Date('2026-07-05T23:30:00.000Z')
    const { subject, html, text } = generateAccountDeletionRequestedEmail({
      purgeDate: lateDay,
      recoveryEmail,
      locale: 'et',
    })

    for (const body of [subject, html, text]) {
      expect(body).toContain('5. juuli 2026')
      expect(body).not.toContain('5 July 2026')
    }
  })

  it('renders Estonian body copy and CTA', () => {
    const { html, text } = generateAccountDeletionRequestedEmail({
      purgeDate,
      recoveryEmail,
      locale: 'et',
    })

    expect(html).toContain('Konto kustutamine on ajastatud')
    expect(html).toContain('Saime taotluse sinu TestApp konto kustutamiseks.')
    expect(html).toContain('Muutsid meelt?')
    expect(html).toContain('Tühista kustutamine')
    expect(text).toContain('Pärast kuupäeva 5. juuli 2026 ei ole andmeid enam võimalik taastada.')
  })

  it('localizes the cancel mailto subject', () => {
    const en = generateAccountDeletionRequestedEmail({ purgeDate, recoveryEmail, locale: 'en' })
    const et = generateAccountDeletionRequestedEmail({ purgeDate, recoveryEmail, locale: 'et' })

    expect(en.html).toContain(`mailto:${recoveryEmail}?subject=Cancel%20account%20deletion`)
    expect(et.html).toContain(`mailto:${recoveryEmail}?subject=T%C3%BChista%20konto%20kustutamine`)
  })

  it('bolds the purge date in HTML and leaves the tag out of plain text', () => {
    const { html, text } = generateAccountDeletionRequestedEmail({
      purgeDate,
      recoveryEmail,
      locale: 'et',
    })

    expect(html).toContain('<strong>5. juuli 2026</strong>')
    expect(text).not.toContain('<strong>')
    expect(text).toContain('5. juuli 2026')
  })

  it('leaves no English copy in the Estonian email', () => {
    const { subject, html, text } = generateAccountDeletionRequestedEmail({
      purgeDate,
      recoveryEmail,
      locale: 'et',
    })

    for (const body of [subject, html, text]) {
      expect(body).not.toContain('Account deletion scheduled')
      expect(body).not.toContain('Changed your mind?')
      expect(body).not.toContain('Cancel deletion')
    }
  })

  it('keeps the legal-entity sign-off and recovery address in Estonian', () => {
    const { html, text } = generateAccountDeletionRequestedEmail({
      purgeDate,
      recoveryEmail,
      locale: 'et',
    })

    expect(html).toContain('Honkadori OÜ')
    expect(html).toContain(recoveryEmail)
    expect(text).toContain('Honkadori OÜ')
    expect(text).toContain(recoveryEmail)
  })
})
