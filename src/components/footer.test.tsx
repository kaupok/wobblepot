import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConsentContext, type AnalyticsConsent } from '@/components/ConsentProvider'
import { Footer } from '@/components/footer'

function renderFooter(consent: AnalyticsConsent) {
  return render(
    <ConsentContext.Provider value={consent}>
      <Footer />
    </ConsentContext.Provider>,
  )
}

describe('Footer', () => {
  it('renders a support email link with the correct mailto href', () => {
    renderFooter({ granted: true, grant: vi.fn(), withdraw: vi.fn() })

    const link = screen.getByRole('link', { name: /support@wobblepot\.com/i })
    expect(link).toHaveAttribute('href', 'mailto:support@wobblepot.com')
  })

  it('renders the cookie settings trigger alongside support', () => {
    renderFooter({ granted: true, grant: vi.fn(), withdraw: vi.fn() })
    expect(screen.getByRole('button', { name: /cookie settings/i })).toBeInTheDocument()
  })

  it('renders privacy and terms links (HON-457)', () => {
    renderFooter({ granted: true, grant: vi.fn(), withdraw: vi.fn() })

    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute(
      'href',
      '/privacy',
    )
    expect(screen.getByRole('link', { name: /terms of service/i })).toHaveAttribute(
      'href',
      '/terms',
    )
  })
})
