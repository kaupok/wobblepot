import { describe, it, expect, vi } from 'vitest'
import { generateEmailChangedEmail } from './email-changed'

vi.mock('@/lib/env', () => ({
  serverEnv: {
    NEXT_PUBLIC_APP_NAME: 'Wobblepot',
  },
}))

describe('generateEmailChangedEmail', () => {
  it('names the new address and support, in English', () => {
    const { subject, html, text } = generateEmailChangedEmail({
      newEmail: 'new@example.com',
      locale: 'en',
    })

    expect(subject).toBe('Your Wobblepot email address changed')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<strong>new@example.com</strong>')
    expect(html).toContain('href="mailto:support@wobblepot.com"')
    expect(text).toContain(
      'The email address of your Wobblepot account is now new@example.com. Account emails no longer come to this address.',
    )
    expect(text).toContain('If you did not do this, write to support@wobblepot.com right away.')
  })

  it('escapes the new address in the HTML only', () => {
    const { html, text } = generateEmailChangedEmail({ newEmail: '"a<b>"@example.com' })

    expect(html).toContain('&quot;a&lt;b&gt;&quot;@example.com')
    expect(html).not.toContain('a<b>')
    expect(text).toContain('"a<b>"@example.com')
  })

  it('writes the mail in Estonian', () => {
    const { subject, html, text } = generateEmailChangedEmail({
      newEmail: 'uus@example.com',
      locale: 'et',
    })

    expect(subject).toBe('Sinu Wobblepot e-posti aadress muutus')
    expect(html).toContain('<html lang="et">')
    expect(html).toContain('<strong>uus@example.com</strong>')
    expect(html).toContain('href="mailto:support@wobblepot.com"')
    expect(text).toContain(
      'Sinu Wobblepot konto e-posti aadress on nüüd uus@example.com. Konto kirjad sellele aadressile enam ei tule.',
    )
    expect(text).toContain('Kui see polnud sina, kirjuta kohe aadressile support@wobblepot.com.')
  })

  it('defaults to English without a locale', () => {
    expect(generateEmailChangedEmail({ newEmail: 'new@example.com' }).subject).toBe(
      'Your Wobblepot email address changed',
    )
  })
})
