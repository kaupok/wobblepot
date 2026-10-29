import { describe, expect, it, vi } from 'vitest'

import { generateChangeEmailEmail } from './change-email'

vi.mock('@/lib/env', () => ({
  serverEnv: {
    NEXT_PUBLIC_APP_NAME: 'Wobblepot',
  },
}))

const verifyUrl =
  'https://wobblepot.com/api/auth/verify-email?token=abc123&callbackURL=%2Faccount%3FemailChanged%3D1'

describe('generateChangeEmailEmail', () => {
  it('asks the recipient to confirm the new address, in English', () => {
    const { subject, html, text } = generateChangeEmailEmail({ verifyUrl, locale: 'en' })

    expect(subject).toBe('Confirm your new Wobblepot email address')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('Confirm your new email address')
    expect(html).toContain('Click the button below to use this address for your Wobblepot account:')
    expect(text).toContain('Open the link below to use this address for your Wobblepot account:')
  })

  it('links the button and the plain text to the change URL', () => {
    const { html, text } = generateChangeEmailEmail({ verifyUrl, locale: 'en' })

    expect(html).toContain(`href="${verifyUrl}"`)
    expect(html).toContain('Confirm new address')
    expect(text).toContain(verifyUrl)
  })

  it('says the link works for 24 hours and to ignore an unasked change', () => {
    const { html, text } = generateChangeEmailEmail({ verifyUrl, locale: 'en' })

    for (const body of [html, text]) {
      expect(body).toContain(
        'The link works for 24 hours. Your account email changes only when you open it.',
      )
      expect(body).toContain(
        'If you did not ask to change your Wobblepot email, ignore this email and do not open the link.',
      )
    }
  })

  it('does not use the sign-up copy', () => {
    const { subject, html } = generateChangeEmailEmail({ verifyUrl, locale: 'en' })

    expect(subject).not.toBe('Confirm your Wobblepot email address')
    expect(html).not.toContain('If you did not create a Wobblepot account')
  })

  it('writes the mail in Estonian', () => {
    const { subject, html, text } = generateChangeEmailEmail({ verifyUrl, locale: 'et' })

    expect(subject).toBe('Kinnita oma uus Wobblepot e-posti aadress')
    expect(html).toContain('<html lang="et">')
    expect(html).toContain('Kinnita uus aadress')
    expect(html).toContain(`href="${verifyUrl}"`)
    expect(text).toContain(verifyUrl)
    for (const body of [html, text]) {
      expect(body).toContain(
        'Link kehtib 24 tundi. Konto e-posti aadress muutub alles siis, kui lingi avad.',
      )
      expect(body).toContain(
        'Kui sa ei palunud oma Wobblepot e-posti aadressi muuta, eira seda kirja ja ära linki ava.',
      )
    }
  })
})
