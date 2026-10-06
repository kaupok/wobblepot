import { describe, it, expect, vi } from 'vitest'
import { generateWaitlistInviteEmail } from './waitlist-invite'

vi.mock('@/lib/env', () => ({
  serverEnv: {
    NEXT_PUBLIC_APP_NAME: 'Wobblepot',
  },
}))

const signUpUrl = 'https://wobblepot.com/sign-up'
const base = { code: 'AbC123xyz789', signUpUrl, validDays: 14 }

describe('generateWaitlistInviteEmail', () => {
  it('sends the code, in English', () => {
    const { subject, html, text } = generateWaitlistInviteEmail({ ...base, locale: 'en' })

    expect(subject).toBe('Your Wobblepot invite code')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('Your invite code is here')
    expect(html).toMatch(/monospace[^>]*>\s*AbC123xyz789\s*</)
    expect(text).toContain('AbC123xyz789')
  })

  it('links the button and the plain text to the sign-up page', () => {
    const { html, text } = generateWaitlistInviteEmail({ ...base, locale: 'en' })

    expect(html).toContain(`href="${signUpUrl}"`)
    expect(html).toContain('Create your account')
    expect(text).toContain(signUpUrl)
  })

  it('says how long the code works and what to do if it was not asked for', () => {
    const { html, text } = generateWaitlistInviteEmail({ ...base, locale: 'en' })

    for (const body of [html, text]) {
      expect(body).toContain('The code works for 14 days and once.')
      expect(body).toContain('If you did not ask for this, ignore this email.')
    }
  })

  it('renders in Estonian for an Estonian request', () => {
    const { subject, html, text } = generateWaitlistInviteEmail({ ...base, locale: 'et' })

    expect(subject).toBe('Sinu Wobblepot kutsekood')
    expect(html).toContain('<html lang="et">')
    expect(html).toContain('Loo konto')
    expect(text).toContain('Kood kehtib 14 päeva ja ühe korra.')
    expect(text).toContain('AbC123xyz789')
  })
})
