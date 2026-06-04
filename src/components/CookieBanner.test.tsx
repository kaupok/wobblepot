import { describe, expect, it, vi } from 'vitest'
// `t.rich` (privacy-policy link) returns React elements, which the default
// vitest next-intl mock (a plain string-resolver) cannot handle. Use the real
// provider so the `<link>` markup actually renders an anchor.
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../messages/en.json'
import { ConsentContext, type AnalyticsConsent } from '@/components/ConsentProvider'
import { CookieBanner } from '@/components/CookieBanner'

function renderWithConsent(value: AnalyticsConsent) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ConsentContext.Provider value={value}>
        <CookieBanner />
      </ConsentContext.Provider>
    </NextIntlClientProvider>,
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

  it('mentions that the choice can be revisited from the footer', () => {
    renderWithConsent({ granted: null, grant: vi.fn(), withdraw: vi.fn() })
    expect(screen.getByText(/you can change this any time from the footer/i)).toBeInTheDocument()
  })

  it('links the cookies section of the privacy policy (informed consent, HON-457)', () => {
    renderWithConsent({ granted: null, grant: vi.fn(), withdraw: vi.fn() })

    const link = screen.getByRole('link', { name: /privacy policy/i })
    expect(link).toHaveAttribute('href', '/privacy#cookies')
  })
})
