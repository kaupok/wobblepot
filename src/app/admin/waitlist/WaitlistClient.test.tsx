import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { createQueryWrapper } from '@/test/query-wrapper'
import type { WaitlistRow } from '@/lib/waitlist'
import { WaitlistClient } from './WaitlistClient'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const notInvited: WaitlistRow = {
  id: 'w1',
  email: 'anna@example.com',
  locale: 'et',
  source: 'mealime',
  confirmedAt: '2026-10-05T12:00:00.000Z',
  invitedAt: null,
}
const invited: WaitlistRow = {
  id: 'w2',
  email: 'ben@example.com',
  locale: 'en',
  source: null,
  confirmedAt: '2026-10-04T12:00:00.000Z',
  invitedAt: '2026-10-06T08:00:00.000Z',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | undefined,
  list: WaitlistRow[],
) {
  return vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    return handler(url, init) ?? json({ requests: list })
  })
}

function renderClient(rows: WaitlistRow[] = [notInvited, invited]) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const { wrapper } = createQueryWrapper()
  render(<WaitlistClient initialRequests={rows} />, { wrapper })
  return user
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
})

describe('WaitlistClient', () => {
  it('lists each request with its locale, source and dates, and labels the invite action by state', () => {
    renderClient()

    const list = screen.getByTestId('waitlist-list')
    expect(within(list).getByText('anna@example.com')).toBeInTheDocument()
    expect(
      within(list).getByText(/^et · Source: mealime · Confirmed .* · Not invited$/),
    ).toBeInTheDocument()
    // No source is a direct visit, said in inline English (admin pages are untranslated).
    expect(
      within(list).getByText(/^en · Source: direct · Confirmed .* · Invited /),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Send invite to anna@example.com' }),
    ).toHaveTextContent('Send invite')
    expect(screen.getByRole('button', { name: 'Send again to ben@example.com' })).toHaveTextContent(
      'Send again',
    )
  })

  it('shows an empty state with no confirmed requests', () => {
    renderClient([])
    expect(screen.getByText('No confirmed requests yet.')).toBeInTheDocument()
  })

  it('sends an invite with a POST and shows Send again after the refetch', async () => {
    const after = { ...notInvited, invitedAt: '2026-10-07T10:00:00.000Z' }
    const fetchMock = mockFetch(
      (url, init) =>
        url === '/api/admin/waitlist/w1/invite' && init?.method === 'POST'
          ? json({ invitedAt: after.invitedAt })
          : undefined,
      [after, invited],
    )
    const user = renderClient()

    await user.click(screen.getByRole('button', { name: 'Send invite to anna@example.com' }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Send again to anna@example.com' }),
      ).toBeInTheDocument(),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/waitlist/w1/invite',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(toast.success).toHaveBeenCalledWith('Invite sent to anna@example.com')
  })

  it('says the email did not send when the route answers 502', async () => {
    mockFetch(
      (url) =>
        url.endsWith('/invite')
          ? json({ error: 'Failed to send the invite email' }, 502)
          : undefined,
      [notInvited, invited],
    )
    const user = renderClient()

    await user.click(screen.getByRole('button', { name: 'Send invite to anna@example.com' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('The invite email did not send. Try again.'),
    )
  })

  it('removes a request only after the dialog is confirmed', async () => {
    const fetchMock = mockFetch(
      (url, init) =>
        url === '/api/admin/waitlist/w1' && init?.method === 'DELETE'
          ? json({ ok: true })
          : undefined,
      [invited],
    )
    const user = renderClient()

    await user.click(screen.getByRole('button', { name: 'Remove anna@example.com' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Remove this request?')).toBeInTheDocument()
    expect(within(dialog).getByText(/anna@example.com leaves the waitlist/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/admin/waitlist/w1',
      expect.objectContaining({ method: 'DELETE' }),
    )

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/waitlist/w1',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(screen.queryByText('anna@example.com')).not.toBeInTheDocument()
    // The Remove button left with its row, so focus goes to the list heading,
    // not to <body>.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Confirmed requests' })).toHaveFocus(),
    )
  })

  it.each([
    ['ACCOUNT_EXISTS', 'This address already has an account. Remove the request instead.'],
    [
      'INVITE_CONFLICT',
      'Another invite to this address was sent at the same time. Only that one counts.',
    ],
  ])('explains a 409 with code %s', async (code, message) => {
    mockFetch(
      (url) => (url.endsWith('/invite') ? json({ error: 'x', code }, 409) : undefined),
      [notInvited, invited],
    )
    const user = renderClient()

    await user.click(screen.getByRole('button', { name: 'Send invite to anna@example.com' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
  })

  it('sends no DELETE when the dialog is cancelled, and returns focus to Remove', async () => {
    const fetchMock = mockFetch(() => undefined, [notInvited, invited])
    const user = renderClient()
    const remove = screen.getByRole('button', { name: 'Remove anna@example.com' })

    await user.click(remove)
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/waitlist/w1'),
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(remove).toHaveFocus()
  })
})
