import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConsentContext, type AnalyticsConsent } from '@/components/ConsentProvider'
import { CookieSettingsTrigger } from '@/components/CookieSettingsTrigger'

function renderWithConsent(value: AnalyticsConsent) {
  return render(
    <ConsentContext.Provider value={value}>
      <CookieSettingsTrigger />
    </ConsentContext.Provider>,
  )
}

describe('CookieSettingsTrigger', () => {
  it('renders the "Cookie settings" trigger', () => {
    renderWithConsent({ granted: true, grant: vi.fn(), withdraw: vi.fn() })
    expect(screen.getByRole('button', { name: /cookie settings/i })).toBeInTheDocument()
  })

  it('opens the dialog and shows the current choice', async () => {
    const user = userEvent.setup()
    renderWithConsent({ granted: true, grant: vi.fn(), withdraw: vi.fn() })

    await user.click(screen.getByRole('button', { name: /cookie settings/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveTextContent(/analytics on/i)
  })

  it('calls grant and closes when "Accept analytics" is clicked', async () => {
    const user = userEvent.setup()
    const grant = vi.fn()
    const withdraw = vi.fn()
    renderWithConsent({ granted: false, grant, withdraw })

    await user.click(screen.getByRole('button', { name: /cookie settings/i }))
    await user.click(await screen.findByRole('button', { name: /accept analytics/i }))

    expect(grant).toHaveBeenCalledTimes(1)
    expect(withdraw).not.toHaveBeenCalled()
  })

  it('calls withdraw and closes when "Essential only" is clicked', async () => {
    const user = userEvent.setup()
    const grant = vi.fn()
    const withdraw = vi.fn()
    renderWithConsent({ granted: true, grant, withdraw })

    await user.click(screen.getByRole('button', { name: /cookie settings/i }))
    await user.click(await screen.findByRole('button', { name: /essential only/i }))

    expect(withdraw).toHaveBeenCalledTimes(1)
    expect(grant).not.toHaveBeenCalled()
  })

  it('reflects undecided state as "Not set"', async () => {
    const user = userEvent.setup()
    renderWithConsent({ granted: null, grant: vi.fn(), withdraw: vi.fn() })

    await user.click(screen.getByRole('button', { name: /cookie settings/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/not set/i)
  })
})
