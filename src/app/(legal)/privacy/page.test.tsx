import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import axe from 'axe-core'
import PrivacyPage, { metadata } from './page'

function renderedText(): string {
  const { container } = render(<PrivacyPage />)
  return container.textContent ?? ''
}

describe('PrivacyPage', () => {
  it('names the data controller verbatim (GDPR Art. 13(1)(a))', () => {
    const text = renderedText()
    expect(text).toContain('Honkadori OÜ')
    expect(text).toContain('14197288')
    expect(text).toContain('Peetri 11, 10415 Tallinn, Estonia')
    expect(text).toContain('privacy@wobblepot.com')
  })

  it('lists all 5 processors, with Neon disclosed as a Databricks company', () => {
    const text = renderedText()
    expect(text).toContain('Anthropic, PBC')
    expect(text).toContain('Resend (Plus Five Five, Inc.)')
    expect(text).toContain('Vercel Inc.')
    expect(text).toContain('Neon (a Databricks company)')
    expect(text).toContain('PostHog, Inc.')
  })

  it('discloses invite requests: the data, the consent basis and both retention windows (HON-846)', () => {
    const text = renderedText().replace(/\s+/g, ' ')
    expect(text).toContain(
      'Invite requests: the email address and language you give us when you ask for an invite, and the name of the link you followed to the form, when it has one.',
    )
    expect(text).toContain('and keeping your place on the invite list after you confirm your email')
    expect(text).toContain(
      'Invite requests: an unconfirmed request is deleted after 7 days. A confirmed request is deleted 6 months after confirmation, or sooner when you sign up with the code we send or ask us to remove it.',
    )
  })

  it('discloses the weekly reminder: the data and the consent basis (HON-1084, HON-1113)', () => {
    const text = renderedText().replace(/\s+/g, ' ')
    expect(text).toContain(
      'Weekly reminder: the day you chose, when you switched the reminder on, when you confirmed your email address for it, and when we last sent it.',
    )
    expect(text).toContain(
      'The weekly planning reminder email is also consent: we send it only after you switch it on',
    )
    expect(text).toContain(
      'and then open the link in the email we send to confirm your address. Every reminder has a link to stop it.',
    )
  })

  // The reminder left the Household page for My account (HON-1256), so the
  // policy names the place a person gives and withdraws that consent.
  it('names My account → Reminders as the place to switch the reminder on', () => {
    const text = renderedText().replace(/\s+/g, ' ')
    expect(text).toContain(
      'switch it on, in My account → Reminders or when you plan your first meals',
    )
    expect(text).not.toContain('on the Household page or when you plan your first meals')
  })

  it('links to the dedicated subprocessors page (HON-543)', () => {
    render(<PrivacyPage />)
    expect(screen.getByRole('link', { name: 'subprocessors page' })).toHaveAttribute(
      'href',
      '/privacy/subprocessors',
    )
  })

  it('summarises the US transfer and DPA coverage inline (full table on /privacy/subprocessors)', () => {
    const text = renderedText()
    expect(text).toContain('transfer to the United States')
    expect(text).toContain('data processing agreement with every one of them')
    // PostHog in the browser is consent-gated (HON-462); server-side records,
    // such as MCP tool calls, are not, and the policy says so (HON-1161).
    expect(text).toContain('in your browser active only after you accept analytics cookies')
    expect(text).toContain('each request a connected AI assistant makes, do not depend on cookies')
  })

  it('states all retention numbers from the issue scope', () => {
    const text = renderedText()
    expect(text).toContain(
      'purged after a 30-day grace period; the purge runs nightly, so deletion happens within a day of that period ending',
    )
    expect(text).toContain('6-hour point-in-time-recovery window')
    expect(text).toContain('runtime logs are kept for 1 day, build logs for 7 days')
    expect(text).toContain('roughly 30 days')
    expect(text).toContain('rotating 7-day lifetime')
    expect(text).toContain('12-month rolling window')
    expect(text).toContain('as long as your account is active')
  })

  it('discloses what Google sign-in sends us (HON-1157)', () => {
    const text = renderedText()
    expect(text).toContain(
      'Google sign-in, if you choose it: your name, email address and Google account identifier',
    )
    expect(text).toContain('we do not keep your Google profile picture')
  })

  it('discloses AI processing of personal data by Anthropic', () => {
    const text = renderedText()
    expect(text).toContain(
      'we transmit your household preferences, allergens, and member dietary data to Anthropic',
    )
    expect(text).toContain('swap suggestions')
    expect(text).toContain('preparation tips')
  })

  it('discloses connected AI assistants as a third party the user chooses (HON-1161)', () => {
    const { container } = render(<PrivacyPage />)
    const section = container.querySelector('#ai-assistants')
    expect(section).not.toBeNull()
    const text = (section?.textContent ?? '').replace(/\s+/g, ' ')
    // What it reads: every MCP tool's data set, plus the `profile` scope.
    expect(text).toContain(
      'can read your household’s meal plan, shopping list, pantry, and recipes. If the consent page says so, it can also see your name and profile picture.',
    )
    // What it can change, only with the write scope (HON-1154).
    expect(text).toContain(
      'If the consent page says “Update your shopping list, pantry and meal plan, and add and change recipes” and you choose Allow, the assistant can also make changes when you ask it to: mark shopping list items as bought, add items to the list, change what is in your pantry, change your meal plan, and add a recipe to your household’s recipes or change one of them.',
    )
    // `create_meal` and `update_meal` make no model call (HON-1305, HON-1314).
    expect(text).toContain(
      'Adding or changing a recipe makes no AI call: the recipe is stored as you would type it in the app, and is then used like any recipe you typed.',
    )
    // `adjust_meal` passes the instruction to the AI provider (HON-1246).
    expect(text).toContain(
      'When you ask the assistant to change a meal’s ingredients, the instruction it passes on is sent to our AI provider, as the same request from the app is.',
    )
    expect(text).toContain('Without that line on the consent page, an assistant can only read.')
    expect(text).toContain('An assistant cannot delete recipes')
    expect(text).toContain('allow the assistant on the consent page')
    expect(text).toContain('The assistant is not one of our processors.')
    expect(text).toContain('we share the data on your instruction')
    expect(text).toContain(
      'We do not record the data it read, what it searched for, or what it changed.',
    )
    // `list_meals` hard-filters allergen meals, so the allergen list is inferable.
    expect(text).toContain('so an assistant can work out which allergens you avoid')
    expect(text).toContain('when you allow an assistant, you agree that it can learn them this way')
    expect(text).toContain('Deleting your account disconnects every assistant at once.')
  })

  it('keeps the connected assistant off the processor list and states its retention (HON-1161)', () => {
    const text = renderedText().replace(/\s+/g, ' ')
    expect(text).toContain('We use five processors:')
    expect(text).toContain('An AI assistant you connect to Wobblepot is not on this list')
    expect(text).toContain('an access token works for 1 hour')
    expect(text).toContain('so the connection stops working after 30 days without use')
    expect(text).toContain(
      'Deleting your account removes all of them at once, without the 30-day grace period.',
    )
    // The nightly purge deletes expired token rows (HON-1165).
    expect(text).toContain(
      'We delete the record of each token within a day after the token expires.',
    )
  })

  it('links the data export endpoint (Art. 20 portability)', () => {
    render(<PrivacyPage />)
    expect(screen.getByRole('link', { name: '/api/auth/user/export' })).toHaveAttribute(
      'href',
      '/api/auth/user/export',
    )
  })

  it('mentions the supervisory-authority complaint right including AKI', () => {
    const text = renderedText()
    expect(text).toContain('Andmekaitse Inspektsioon')
    expect(text).toContain('supervisory authority')
  })

  it("has a children's-data section with the under-16 threshold and parental consent", () => {
    const text = renderedText()
    expect(text).toContain('aged 16 or over')
    expect(text).toContain('parent or legal guardian')
  })

  it('has a #cookies anchor target for the cookie banner link', () => {
    const { container } = render(<PrivacyPage />)
    expect(container.querySelector('#cookies')).not.toBeNull()
  })

  it('shows a last-updated line (anchor for consent version bumps)', () => {
    const text = renderedText()
    expect(text).toContain('Last updated:')
  })

  it('has no axe violations (the Storybook gate only covers components, not pages)', async () => {
    const { container } = render(<PrivacyPage />)
    const results = await axe.run(container, {
      // jsdom has no layout engine, so color-contrast cannot be computed
      // here — it is covered by the Storybook a11y gate for the primitives.
      rules: { 'color-contrast': { enabled: false } },
    })
    expect(results.violations).toEqual([])
  })

  it('has English metadata for every household locale (HON-918)', () => {
    expect(metadata).toEqual({
      title: 'Privacy policy',
      description: 'How Wobblepot collects, uses, and protects your data.',
    })
  })
})
