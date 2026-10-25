import { describe, it, expect, vi, beforeEach } from 'vitest'
// The real provider, so the Estonian case renders the et catalog rather than
// the global mock's English fallback.
vi.unmock('next-intl')
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { dropFocusToBody } from '@/test/focus'
import { ConsentCard } from './ConsentCard'

vi.mock('@/lib/auth-client', () => ({
  authClient: { oauth2: { consent: vi.fn() } },
}))

import { authClient } from '@/lib/auth-client'

const consent = vi.mocked(authClient.oauth2.consent)

function renderCard(node: ReactNode, locale: 'en' | 'et' = 'en') {
  const { wrapper } = createQueryWrapper()
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'et' ? etMessages : enMessages}>
      {node}
    </NextIntlClientProvider>,
    { wrapper },
  )
}

const READY = {
  status: 'ready' as const,
  clientName: 'Claude',
  redirectTarget: 'claude.ai',
  householdName: 'Tammed',
  scopes: ['mcp:read' as const, 'openid' as const, 'offline_access' as const],
}

describe('ConsentCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the write-scope sentence when the assistant asks to make changes', () => {
    renderCard(<ConsentCard {...READY} scopes={['mcp:read', 'mcp:write', 'offline_access']} />)

    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual([
      'Read your meal plan, shopping list, pantry and recipes.',
      'Update your shopping list, pantry and meal plan, and add and change recipes.',
      'Stay connected, so you do not need to allow it again.',
    ])
    // The read-only promise would be false with the write scope.
    expect(screen.queryByText('It cannot change anything in Wobblepot.')).toBeNull()
  })

  it('leaves the write-scope sentence out for a read-only request, and says it cannot change anything', () => {
    renderCard(<ConsentCard {...READY} />)

    expect(
      screen.queryByText(
        'Update your shopping list, pantry and meal plan, and add and change recipes.',
      ),
    ).toBeNull()
    expect(screen.getByText('It cannot change anything in Wobblepot.')).toBeInTheDocument()
  })

  it('names the app, the household and what it can do', () => {
    renderCard(<ConsentCard {...READY} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Connect Claude?' })).toBeInTheDocument()
    expect(screen.getByText('Household: Tammed')).toBeInTheDocument()
    // The self-declared name is not proof; the destination host is.
    expect(screen.getByText('Your answer is sent to claude.ai.')).toBeInTheDocument()
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual([
      'Read your meal plan, shopping list, pantry and recipes.',
      'Confirm that it is you.',
      'Stay connected, so you do not need to allow it again.',
    ])
    // Tool-call analytics are server-side, outside the cookie banner (HON-1151).
    expect(
      screen.getByText(
        'Wobblepot records each request it makes: which tool, how long it took and the reason the assistant gave. It does not record what it reads or changes.',
      ),
    ).toBeInTheDocument()
  })

  it('renders Estonian copy', () => {
    renderCard(<ConsentCard {...READY} />, 'et')

    expect(screen.getByRole('heading', { name: 'Kas ühendada Claude?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Luba' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keela' })).toBeInTheDocument()
  })

  it('uses a generic title when the app sent no name', () => {
    renderCard(<ConsentCard {...READY} clientName={null} householdName={null} />)

    expect(screen.getByRole('heading', { name: 'Connect this app?' })).toBeInTheDocument()
    expect(screen.queryByText(/^Household:/)).not.toBeInTheDocument()
  })

  it('sends accept: true on Allow and keeps both buttons disabled while the browser leaves', async () => {
    consent.mockResolvedValue({
      data: { redirect: true, url: 'https://claude.ai/cb?code=abc' },
      error: null,
    } as never)
    const user = userEvent.setup()
    renderCard(<ConsentCard {...READY} />)

    await user.click(screen.getByRole('button', { name: 'Allow' }))

    expect(consent).toHaveBeenCalledWith({ accept: true })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled()
  })

  it('sends accept: false on Deny', async () => {
    consent.mockResolvedValue({
      data: { redirect: true, url: 'https://claude.ai/cb?error=access_denied' },
      error: null,
    } as never)
    const user = userEvent.setup()
    renderCard(<ConsentCard {...READY} />)

    await user.click(screen.getByRole('button', { name: 'Deny' }))

    expect(consent).toHaveBeenCalledWith({ accept: false })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled())
  })

  it('shows catalog copy, not the server error, and returns focus to the button', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    let answer!: (value: unknown) => void
    consent.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }) as never,
    )
    const user = userEvent.setup()
    renderCard(<ConsentCard {...READY} />)

    const allow = screen.getByRole('button', { name: 'Allow' })
    await user.click(allow)
    await waitFor(() => expect(allow).toBeDisabled())
    // Chromium blurs a control when it becomes disabled; jsdom does not.
    dropFocusToBody()
    answer({ data: null, error: { status: 400, message: 'invalid_signature' } })

    expect(
      await screen.findByText('Could not finish connecting. Start again from the app.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/invalid_signature/)).not.toBeInTheDocument()
    await waitFor(() => expect(allow).toHaveFocus())
    expect(allow).toBeEnabled()
    error.mockRestore()
  })

  it('offers a way home for an invalid request', () => {
    renderCard(<ConsentCard status="invalid" />)

    expect(screen.getByRole('heading', { name: 'Connection request expired' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
  })
})
