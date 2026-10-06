import { describe, it, expect, vi } from 'vitest'
import { generateWaitlistConfirmEmail } from './waitlist-confirm'

vi.mock('@/lib/env', () => ({
  serverEnv: {
    NEXT_PUBLIC_APP_NAME: 'Wobblepot',
  },
}))

const confirmUrl = 'https://wobblepot.com/request-invite/confirm?token=abc123'

describe('generateWaitlistConfirmEmail', () => {
  it('asks the recipient to confirm, in English', () => {
    const { subject, html, text } = generateWaitlistConfirmEmail({ confirmUrl, locale: 'en' })

    expect(subject).toBe('Confirm your Wobblepot invite request')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('Confirm your invite request')
    expect(html).toContain('Someone asked for a Wobblepot invite with this email address.')
    expect(text).toContain('Someone asked for a Wobblepot invite with this email address.')
  })

  it('links the button and the plain text to the confirm URL', () => {
    const { html, text } = generateWaitlistConfirmEmail({ confirmUrl, locale: 'en' })

    expect(html).toContain(`href="${confirmUrl}"`)
    expect(html).toContain('Join the list')
    expect(text).toContain(confirmUrl)
  })

  it('says how long the link works and what happens if it was not you', () => {
    const { html, text } = generateWaitlistConfirmEmail({ confirmUrl, locale: 'en' })

    for (const body of [html, text]) {
      expect(body).toContain('The link works for 7 days.')
      expect(body).toContain(
        'If this was not you, ignore this email. The request is deleted after 7 days.',
      )
    }
  })

  it('renders in Estonian for an Estonian request', () => {
    const { subject, html, text } = generateWaitlistConfirmEmail({ confirmUrl, locale: 'et' })

    expect(subject).toBe('Kinnita oma Wobblepot kutsesoov')
    expect(html).toContain('<html lang="et">')
    expect(html).toContain('Liitu nimekirjaga')
    expect(text).toContain('Link kehtib 7 päeva.')
    expect(text).toContain(confirmUrl)
  })
})
