import { describe, it, expect, vi } from 'vitest'
import { generateWeeklyReminderEmail } from './weekly-reminder'

vi.mock('@/lib/env', () => ({
  serverEnv: {
    NEXT_PUBLIC_APP_NAME: 'Wobblepot',
  },
}))

const appUrl = 'https://wobblepot.com/'
const stopUrl = 'https://wobblepot.com/reminders/stop?token=abc123'
const base = { appUrl, stopUrl }

describe('generateWeeklyReminderEmail', () => {
  it('says next week is empty, in English', () => {
    const { subject, html, text } = generateWeeklyReminderEmail({ ...base, locale: 'en' })

    expect(subject).toBe('Next week is not planned yet')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('Next week is empty')
    for (const body of [html, text]) {
      expect(body).toContain(
        'No meals are planned for next week. Pick them now, and the shopping list follows.',
      )
    }
  })

  it('links the button and the plain text to the app', () => {
    const { html, text } = generateWeeklyReminderEmail({ ...base, locale: 'en' })

    expect(html).toContain(`href="${appUrl}"`)
    expect(html).toContain('Plan next week')
    expect(text).toContain(appUrl)
  })

  it('says why the email came and links to the stop page', () => {
    const { html, text } = generateWeeklyReminderEmail({ ...base, locale: 'en' })

    for (const body of [html, text]) {
      expect(body).toContain(
        'You get this email because you switched on the weekly reminder in Wobblepot.',
      )
      expect(body).toContain('Stop the reminders')
    }
    expect(html).toContain(`href="${stopUrl}"`)
    expect(text).toContain(stopUrl)
  })

  it('renders in Estonian for an Estonian household', () => {
    const { subject, html, text } = generateWeeklyReminderEmail({ ...base, locale: 'et' })

    expect(subject).toBe('Järgmine nädal on veel planeerimata')
    expect(html).toContain('<html lang="et">')
    expect(html).toContain('Planeeri järgmine nädal')
    expect(text).toContain('Peata meeldetuletused')
    expect(text).toContain(stopUrl)
  })
})
