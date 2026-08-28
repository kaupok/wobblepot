import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import axe from 'axe-core'
import SubprocessorsPage from './page'

function renderedText(): string {
  const { container } = render(<SubprocessorsPage />)
  return container.textContent ?? ''
}

describe('SubprocessorsPage', () => {
  it('lists all 5 processors, with Neon disclosed as a Databricks company', () => {
    const text = renderedText()
    expect(text).toContain('Anthropic, PBC')
    expect(text).toContain('Resend (Plus Five Five, Inc.)')
    expect(text).toContain('Vercel Inc.')
    expect(text).toContain('Neon (a Databricks company)')
    expect(text).toContain('PostHog, Inc.')
  })

  it('renders the table with one row per processor plus header', () => {
    render(<SubprocessorsPage />)
    // 1 header row + 5 processor rows
    expect(screen.getAllByRole('row')).toHaveLength(6)
  })

  it('states exact processing regions and transfer safeguards (SCCs status per US processor)', () => {
    const text = renderedText()
    expect(text).toContain('EU (Frankfurt)')
    expect(text).toContain('Databricks, Inc. (US)')
    expect(text).toContain('EU-US DPF')
    expect(text).toContain('UK IDTA')
    expect(text).toContain('UK Addendum')
    expect(text).toContain('UK SCCs')
    // PostHog is consent-gated (HON-462)
    expect(text).toContain('Active only after you accept analytics cookies.')
  })

  it('links every processor to its privacy policy and DPA with vendor-qualified names', () => {
    render(<SubprocessorsPage />)
    const externalLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('https://'))
    const privacyLinks = externalLinks.filter((link) =>
      link.getAttribute('aria-label')?.endsWith('privacy policy'),
    )
    const dpaLinks = externalLinks.filter((link) =>
      link.getAttribute('aria-label')?.endsWith('DPA'),
    )
    expect(privacyLinks).toHaveLength(5)
    expect(dpaLinks).toHaveLength(5)
    // No two links share an accessible name — distinguishable in a
    // screen-reader links list (WCAG 2.4.4)
    const names = externalLinks.map((link) => link.getAttribute('aria-label'))
    expect(new Set(names).size).toBe(10)
  })

  it('links back to the privacy policy', () => {
    render(<SubprocessorsPage />)
    expect(screen.getByRole('link', { name: 'Back to the privacy policy' })).toHaveAttribute(
      'href',
      '/privacy',
    )
  })

  it('shows a last-updated line (anchor for consent version bumps)', () => {
    const text = renderedText()
    expect(text).toContain('Last updated:')
  })

  it('has no axe violations (the Storybook gate only covers components, not pages)', async () => {
    const { container } = render(<SubprocessorsPage />)
    const results = await axe.run(container, {
      // jsdom has no layout engine, so color-contrast cannot be computed
      // here — it is covered by the Storybook a11y gate for the primitives.
      rules: { 'color-contrast': { enabled: false } },
    })
    expect(results.violations).toEqual([])
  })
})
