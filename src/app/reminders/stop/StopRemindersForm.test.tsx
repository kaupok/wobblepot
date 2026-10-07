import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// `t.rich` (the Household page link) returns React elements, which the default
// next-intl test mock cannot handle; use the real provider.
vi.unmock('next-intl')
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import { StopRemindersForm } from './StopRemindersForm'
import { createQueryWrapper } from '@/test/query-wrapper'

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
        <StopRemindersForm token="token-1" />
      </Wrapper>
    </NextIntlClientProvider>,
  )
}

describe('StopRemindersForm', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('asks before it stops anything', () => {
    renderForm()

    expect(screen.getByRole('heading', { name: 'Stop the weekly reminder?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop the reminders' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts the token and shows the done state with a link to the Household page', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(jsonResponse(200, { stopped: true }))
    renderForm()

    await user.click(screen.getByRole('button', { name: 'Stop the reminders' }))

    const done = await screen.findByRole('heading', { name: 'Done' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reminders/stop',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'token-1' }) }),
    )
    expect(screen.getByRole('link', { name: 'Household page' })).toHaveAttribute(
      'href',
      '/household',
    )
    // The button unmounted; focus moves to the heading that replaced it.
    await waitFor(() => expect(done).toHaveFocus())
  })

  it('shows catalog copy, not the server error, when the stop fails', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'Failed to stop the reminders' }))
    renderForm()

    await user.click(screen.getByRole('button', { name: 'Stop the reminders' }))

    expect(
      await screen.findByText('We could not stop the reminders. Try again.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop the reminders' })).toBeEnabled()
  })

  it('renders in Estonian', () => {
    renderForm('et')

    expect(screen.getByRole('button', { name: 'Peata meeldetuletused' })).toBeInTheDocument()
  })
})
