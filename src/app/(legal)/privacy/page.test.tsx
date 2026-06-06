import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import axe from 'axe-core'
import PrivacyPage from './page'

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
    expect(text).toContain('Resend (Plus Five, Inc.)')
    expect(text).toContain('Vercel Inc.')
    expect(text).toContain('Neon (a Databricks company)')
    expect(text).toContain('PostHog, Inc.')
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
    // PostHog is consent-gated (HON-462)
    expect(text).toContain('active only after you accept analytics cookies')
  })

  it('states all retention numbers from the issue scope', () => {
    const text = renderedText()
    expect(text).toContain('purged within 30 days')
    expect(text).toContain('24-hour point-in-time-recovery window')
    expect(text).toContain('runtime logs are kept for 1 day, build logs for 7 days')
    expect(text).toContain('roughly 30 days')
    expect(text).toContain('rotating 7-day lifetime')
    expect(text).toContain('12-month rolling window')
    expect(text).toContain('as long as your account is active')
  })

  it('discloses AI processing of personal data by Anthropic', () => {
    const text = renderedText()
    expect(text).toContain(
      'we transmit your household preferences, allergens, and member dietary data to Anthropic',
    )
    expect(text).toContain('swap suggestions')
    expect(text).toContain('preparation tips')
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
})
