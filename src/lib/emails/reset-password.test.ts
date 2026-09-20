import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateResetPasswordEmail } from './reset-password'

// Mock the env module
vi.mock('@/lib/env', () => ({
  serverEnv: {
    NEXT_PUBLIC_APP_NAME: 'TestApp',
  },
}))

describe('generateResetPasswordEmail', () => {
  const resetUrl = 'https://example.com/reset-password?token=abc123'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns object with subject, html, and text', () => {
    const result = generateResetPasswordEmail({ resetUrl })

    expect(result).toHaveProperty('subject')
    expect(result).toHaveProperty('html')
    expect(result).toHaveProperty('text')
  })

  it('includes app name in subject', () => {
    const result = generateResetPasswordEmail({ resetUrl })

    expect(result.subject).toBe('Reset your TestApp password')
  })

  it('includes reset URL in HTML content', () => {
    const result = generateResetPasswordEmail({ resetUrl })

    expect(result.html).toContain(resetUrl)
  })

  it('includes reset URL in plain text content', () => {
    const result = generateResetPasswordEmail({ resetUrl })

    expect(result.text).toContain(resetUrl)
  })

  it('includes app name in HTML content', () => {
    const result = generateResetPasswordEmail({ resetUrl })

    expect(result.html).toContain('TestApp')
  })

  it('includes app name in plain text content', () => {
    const result = generateResetPasswordEmail({ resetUrl })

    expect(result.text).toContain('TestApp')
  })

  it('includes security notice about expiration', () => {
    const result = generateResetPasswordEmail({ resetUrl })

    expect(result.html).toContain('expire')
    expect(result.text).toContain('expire')
  })

  it('includes message about ignoring if not requested', () => {
    const result = generateResetPasswordEmail({ resetUrl })

    expect(result.html).toContain("didn't request")
    expect(result.text).toContain("didn't request")
  })
})

describe('generateResetPasswordEmail — locale (HON-513)', () => {
  const resetUrl = 'https://example.com/reset-password?token=abc123'

  it('defaults to English when no locale is passed', () => {
    const omitted = generateResetPasswordEmail({ resetUrl })
    const explicit = generateResetPasswordEmail({ resetUrl, locale: 'en' })

    expect(omitted).toEqual(explicit)
  })

  it('sets <html lang> from the resolved locale', () => {
    expect(generateResetPasswordEmail({ resetUrl, locale: 'en' }).html).toContain(
      '<html lang="en">',
    )
    expect(generateResetPasswordEmail({ resetUrl, locale: 'et' }).html).toContain(
      '<html lang="et">',
    )
  })

  it('returns a different subject per locale', () => {
    const en = generateResetPasswordEmail({ resetUrl, locale: 'en' })
    const et = generateResetPasswordEmail({ resetUrl, locale: 'et' })

    expect(en.subject).toBe('Reset your TestApp password')
    expect(et.subject).toBe('Lähtesta oma TestApp parool')
    expect(et.subject).not.toBe(en.subject)
  })

  it('renders Estonian body copy and CTA', () => {
    const { html, text } = generateResetPasswordEmail({ resetUrl, locale: 'et' })

    // Heading, intro, CTA, expiry notice and the "ignore this" reassurance.
    expect(html).toContain('Lähtesta parool')
    expect(html).toContain('Saime taotluse sinu TestApp konto parooli lähtestamiseks.')
    expect(html).toContain('Turvalisuse huvides aegub see link ühe tunni pärast.')
    expect(html).toContain('Kui sa ei taotlenud parooli lähtestamist')
    expect(text).toContain('Uue parooli valimiseks ava allolev link:')
    expect(text).toContain('Sinu parool jääb muutumatuks.')
  })

  it('leaves no English copy in the Estonian email', () => {
    const { subject, html, text } = generateResetPasswordEmail({ resetUrl, locale: 'et' })

    for (const body of [subject, html, text]) {
      expect(body).not.toContain('Reset your password')
      expect(body).not.toContain("didn't request")
    }
  })

  it('still carries the reset URL and app name in Estonian', () => {
    const { html, text } = generateResetPasswordEmail({ resetUrl, locale: 'et' })

    expect(html).toContain(resetUrl)
    expect(text).toContain(resetUrl)
    expect(html).toContain('TestApp')
  })
})
