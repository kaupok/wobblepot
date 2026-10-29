import { describe, expect, it, vi } from 'vitest'

import { generateVerifyEmailEmail } from './verify-email'

vi.mock('@/lib/env', () => ({
  serverEnv: {
    NEXT_PUBLIC_APP_NAME: 'Wobblepot',
  },
}))

const verifyUrl =
  'https://wobblepot.com/api/auth/verify-email?token=abc123&callbackURL=%2Fprofile%3Fverified%3D1'

describe('generateVerifyEmailEmail', () => {
  it('asks the recipient to confirm the address, in English', () => {
    const { subject, html, text } = generateVerifyEmailEmail({ verifyUrl, locale: 'en' })

    expect(subject).toBe('Confirm your Wobblepot email address')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('Confirm your email address')
    expect(html).toContain(
      'Click the button below to confirm that this address belongs to your Wobblepot account:',
    )
    expect(text).toContain(
      'Open the link below to confirm that this address belongs to your Wobblepot account:',
    )
  })

  it('links the button and the plain text to the verification URL', () => {
    const { html, text } = generateVerifyEmailEmail({ verifyUrl, locale: 'en' })

    expect(html).toContain(`href="${verifyUrl}"`)
    expect(html).toContain('Confirm email address')
    expect(text).toContain(verifyUrl)
  })

  // The ignore line is a security control: someone who signs up with another
  // person's address must not get it verified by that person (HON-1155).
  it('says how long the link works and to ignore the mail without an account', () => {
    const { html, text } = generateVerifyEmailEmail({ verifyUrl, locale: 'en' })

    for (const body of [html, text]) {
      expect(body).toContain('The link works for 24 hours.')
      expect(body).toContain(
        'If you did not create a Wobblepot account, ignore this email and do not open the link.',
      )
    }
  })

  it('writes the mail in Estonian', () => {
    const { subject, html, text } = generateVerifyEmailEmail({ verifyUrl, locale: 'et' })

    expect(subject).toBe('Kinnita oma Wobblepot e-posti aadress')
    expect(html).toContain('<html lang="et">')
    expect(html).toContain('Kinnita e-posti aadress')
    expect(html).toContain(`href="${verifyUrl}"`)
    expect(text).toContain(verifyUrl)
    for (const body of [html, text]) {
      expect(body).toContain('Link kehtib 24 tundi.')
      expect(body).toContain('Kui sa ei loonud Wobblepot kontot, eira seda kirja ja ära linki ava.')
    }
  })

  it('defaults to English without a locale', () => {
    expect(generateVerifyEmailEmail({ verifyUrl }).subject).toBe(
      'Confirm your Wobblepot email address',
    )
  })
})
