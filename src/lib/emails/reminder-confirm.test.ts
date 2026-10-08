import { describe, it, expect, vi } from 'vitest'
import { generateReminderConfirmEmail } from './reminder-confirm'

vi.mock('@/lib/env', () => ({
  serverEnv: {
    NEXT_PUBLIC_APP_NAME: 'Wobblepot',
  },
}))

const confirmUrl = 'https://wobblepot.com/reminders/confirm?token=abc123'

describe('generateReminderConfirmEmail', () => {
  it('says what the reminder is and asks the recipient to confirm, in English', () => {
    const { subject, html, text } = generateReminderConfirmEmail({
      confirmUrl,
      ttlDays: 7,
      locale: 'en',
    })

    expect(subject).toBe('Confirm the Wobblepot weekly reminder')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('Confirm the weekly reminder')
    for (const body of [html, text]) {
      expect(body).toContain(
        'You switched on the Wobblepot weekly reminder for this email address.',
      )
      expect(body).toContain('only when next week has no meals planned')
    }
  })

  it('links the button and the plain text to the confirm URL', () => {
    const { html, text } = generateReminderConfirmEmail({ confirmUrl, ttlDays: 7, locale: 'en' })

    expect(html).toContain(`href="${confirmUrl}"`)
    expect(html).toContain('Start the reminder')
    expect(text).toContain(confirmUrl)
  })

  it('says how long the link works and what to do if it was not you', () => {
    const { html, text } = generateReminderConfirmEmail({ confirmUrl, ttlDays: 7, locale: 'en' })

    for (const body of [html, text]) {
      expect(body).toContain('The link works for 7 days.')
      expect(body).toContain('If this was not you, ignore this email. We send nothing more.')
    }
  })

  it('has no stop link, because nothing runs yet', () => {
    const { html, text } = generateReminderConfirmEmail({ confirmUrl, ttlDays: 7, locale: 'en' })

    for (const body of [html, text]) {
      expect(body).not.toContain('/reminders/stop')
      expect(body).not.toContain('Stop the reminders')
    }
  })

  it('renders in Estonian for an Estonian household', () => {
    const { subject, html, text } = generateReminderConfirmEmail({
      confirmUrl,
      ttlDays: 7,
      locale: 'et',
    })

    expect(subject).toBe('Kinnita Wobblepot iganädalane meeldetuletus')
    expect(html).toContain('<html lang="et">')
    expect(html).toContain('Alusta meeldetuletust')
    expect(text).toContain('Link kehtib 7 päeva.')
    expect(text).toContain(confirmUrl)
  })
})
