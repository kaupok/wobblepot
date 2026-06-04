import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import axe from 'axe-core'
import TermsPage from './page'

function renderedText(): string {
  const { container } = render(<TermsPage />)
  return container.textContent ?? ''
}

describe('TermsPage', () => {
  it('renders the key sections', () => {
    render(<TermsPage />)
    for (const section of [
      'The service',
      'Your account',
      'Acceptable use',
      'AI-generated content',
      'Termination',
      'Liability',
      'Governing law',
      'Contact',
    ]) {
      expect(screen.getByRole('heading', { name: section })).toBeInTheDocument()
    }
  })

  it('names the operating legal entity', () => {
    const text = renderedText()
    expect(text).toContain('Honkadori OÜ')
    expect(text).toContain('14197288')
  })

  it('carries the AI-output disclaimer, tone-consistent with the nutrition disclaimer', () => {
    const text = renderedText()
    expect(text).toContain('estimates for guidance only')
    expect(text).toContain('not medical, nutritional, or allergy advice')
    expect(text).toContain('consult a healthcare professional')
  })

  it('states Estonian governing law', () => {
    const text = renderedText()
    expect(text).toContain('governed by the laws of Estonia')
  })

  it('caps liability and preserves mandatory consumer protections', () => {
    const text = renderedText()
    expect(text).toContain('limited to the amount you paid us in the 12 months')
    expect(text).toContain('consumer')
  })

  it('links the privacy policy', () => {
    render(<TermsPage />)
    const links = screen.getAllByRole('link', { name: 'privacy policy' })
    expect(links.length).toBeGreaterThanOrEqual(1)
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/privacy')
    }
  })

  it('shows a last-updated line (anchor for consent version bumps)', () => {
    const text = renderedText()
    expect(text).toContain('Last updated:')
  })

  it('has no axe violations (the Storybook gate only covers components, not pages)', async () => {
    const { container } = render(<TermsPage />)
    const results = await axe.run(container, {
      // jsdom has no layout engine, so color-contrast cannot be computed
      // here — it is covered by the Storybook a11y gate for the primitives.
      rules: { 'color-contrast': { enabled: false } },
    })
    expect(results.violations).toEqual([])
  })
})
