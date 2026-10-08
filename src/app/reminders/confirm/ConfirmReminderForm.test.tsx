import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// `t.rich` (the Household page link) returns React elements, which the default
// next-intl test mock cannot handle; use the real provider.
vi.unmock('next-intl')
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import { ConfirmReminderForm } from './ConfirmReminderForm'
import { createQueryWrapper } from '@/test/query-wrapper'
import { dropFocusToBody } from '@/test/focus'

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderForm(locale: 'en' | 'et' = 'en') {
  const { wrapper: Wrapper } = createQueryWrapper()
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'et' ? etMessages : enMessages}>
      <Wrapper>
        <ConfirmReminderForm token="confirm-1" ttlDays={7} />
      </Wrapper>
    </NextIntlClientProvider>,
  )
}

describe('ConfirmReminderForm', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('asks before it confirms anything', () => {
    renderForm()

    expect(screen.getByRole('heading', { name: 'Start the weekly reminder?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start the reminder' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts the token and says the reminder is on', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(jsonResponse(200, { confirmed: true }))
    renderForm()

    await user.click(screen.getByRole('button', { name: 'Start the reminder' }))

    const done = await screen.findByRole('heading', { name: 'The weekly reminder is on' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reminders/confirm',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'confirm-1' }) }),
    )
    expect(screen.getByRole('link', { name: 'Household page' })).toHaveAttribute(
      'href',
      '/household',
    )
    // The button unmounted; focus moves to the heading that replaced it.
    await waitFor(() => expect(done).toHaveFocus())
  })

  it('shows the expired state when the route says the token did not confirm', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(jsonResponse(200, { confirmed: false }))
    renderForm()

    await user.click(screen.getByRole('button', { name: 'Start the reminder' }))

    expect(
      await screen.findByRole('heading', { name: 'This link has expired' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/The link works for 7 days/)).toBeInTheDocument()
  })

  it('shows catalog copy, not the server error, and gives focus back when the confirm fails', async () => {
    const user = userEvent.setup()
    let settle: (response: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (settle = resolve)))
    renderForm()

    await user.click(screen.getByRole('button', { name: 'Start the reminder' }))
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled()
    // jsdom does not blur a disabled button; do what Chromium does.
    dropFocusToBody()
    await act(async () => settle(jsonResponse(500, { error: 'Failed to confirm the reminder' })))

    expect(
      await screen.findByText('We could not start the reminder. Try again.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Failed to confirm the reminder')).not.toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Start the reminder' })
    expect(button).toBeEnabled()
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('renders in Estonian', () => {
    renderForm('et')

    expect(screen.getByRole('button', { name: 'Alusta meeldetuletust' })).toBeInTheDocument()
  })
})
