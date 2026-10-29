import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authClient } from '@/lib/auth-client'
import { createQueryWrapper } from '@/test/query-wrapper'

import { SetPassword } from './SetPassword'

vi.mock('@/lib/auth-client', () => ({
  authClient: { requestPasswordReset: vi.fn() },
}))

type ResetResult = Awaited<ReturnType<typeof authClient.requestPasswordReset>>

const ok = { data: { status: true }, error: null } as unknown as ResetResult
function failed(status: number, message = 'Server said no') {
  return { data: null, error: { status, message } } as unknown as ResetResult
}

const mockReset = vi.mocked(authClient.requestPasswordReset)
const SET = { name: 'Set a password' }
const SENT = 'Email sent. Open the link in it to set your password.'

function renderSetPassword() {
  return render(<SetPassword email="ann@example.com" />, {
    wrapper: createQueryWrapper().wrapper,
  })
}

describe('SetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('sends the reset email to the account email, once', async () => {
    mockReset.mockResolvedValue(ok)
    const user = userEvent.setup()
    renderSetPassword()

    await user.click(screen.getByRole('button', SET))

    expect(mockReset).toHaveBeenCalledTimes(1)
    expect(mockReset).toHaveBeenCalledWith({
      email: 'ann@example.com',
      redirectTo: '/reset-password',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(SENT)
    // The sent message replaced the button, so it cannot send again.
    expect(screen.queryByRole('button', SET)).not.toBeInTheDocument()
  })

  it('moves focus to the sent message, since the button goes away', async () => {
    mockReset.mockResolvedValue(ok)
    const user = userEvent.setup()
    renderSetPassword()

    await user.click(screen.getByRole('button', SET))

    const sent = await screen.findByText(SENT)
    await waitFor(() => expect(document.activeElement).toContainElement(sent))
  })

  it('disables the button while the request is in flight', async () => {
    mockReset.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    renderSetPassword()

    await user.click(screen.getByRole('button', SET))

    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled()
  })

  it('shows the rate-limit copy on a 429, not the server message', async () => {
    mockReset.mockResolvedValue(failed(429, 'Too many requests'))
    const user = userEvent.setup()
    renderSetPassword()

    await user.click(screen.getByRole('button', SET))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Please try again in a few minutes.',
    )
    expect(screen.queryByText('Too many requests')).not.toBeInTheDocument()
  })

  it('shows the generic copy on any other failure and returns focus to the button', async () => {
    mockReset.mockResolvedValue(failed(500, 'Internal Server Error'))
    const user = userEvent.setup()
    renderSetPassword()

    await user.click(screen.getByRole('button', SET))

    expect(await screen.findByRole('alert')).toHaveTextContent('The email was not sent. Try again.')
    await waitFor(() => expect(screen.getByRole('button', SET)).toHaveFocus())
  })
})
