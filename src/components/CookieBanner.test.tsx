import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConsentContext, type AnalyticsConsent } from '@/components/ConsentProvider'
import { CookieBanner } from '@/components/CookieBanner'

function renderWithConsent(value: AnalyticsConsent) {
  return render(
    <ConsentContext.Provider value={value}>
      <CookieBanner />
    </ConsentContext.Provider>,
  )
}

describe('CookieBanner', () => {
  it('renders the region with the accessible name "Cookie consent"', () => {
    renderWithConsent({ granted: null, grant: vi.fn(), withdraw: vi.fn() })
    expect(screen.getByRole('region', { name: /cookie consent/i })).toBeInTheDocument()
  })

  it('calls grant when "Accept all" is clicked', async () => {
    const grant = vi.fn()
    const withdraw = vi.fn()
    renderWithConsent({ granted: null, grant, withdraw })

    await userEvent.setup().click(screen.getByRole('button', { name: 'Accept all' }))
    expect(grant).toHaveBeenCalledTimes(1)
    expect(withdraw).not.toHaveBeenCalled()
  })

  it('calls withdraw when "Essential only" is clicked', async () => {
    const grant = vi.fn()
    const withdraw = vi.fn()
    renderWithConsent({ granted: null, grant, withdraw })

    await userEvent.setup().click(screen.getByRole('button', { name: 'Essential only' }))
    expect(withdraw).toHaveBeenCalledTimes(1)
    expect(grant).not.toHaveBeenCalled()
  })

  it('exposes the privacy link', () => {
    renderWithConsent({ granted: null, grant: vi.fn(), withdraw: vi.fn() })
    const link = screen.getByRole('link', { name: /learn more/i })
    expect(link).toHaveAttribute('href', '/privacy#cookies')
  })
})
