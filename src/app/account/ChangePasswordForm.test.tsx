import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { authClient } from '@/lib/auth-client'
import { dropFocusToBody } from '@/test/focus'
import { ChangePasswordForm } from './ChangePasswordForm'

vi.mock('@/lib/auth-client', () => ({
  authClient: { changePassword: vi.fn() },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

type ChangeResult = Awaited<ReturnType<typeof authClient.changePassword>>

const ok = { data: { token: 'new', user: {} }, error: null } as unknown as ChangeResult
function failed(message: string) {
  return { data: null, error: { message, status: 400 } } as unknown as ChangeResult
}

const CURRENT = 'old-password-1234'
const NEXT = 'brand-new-password-5678'

async function fillIn(
  user: ReturnType<typeof userEvent.setup>,
  { current = CURRENT, next = NEXT, confirm = NEXT } = {},
) {
  if (current) await user.type(screen.getByLabelText('Current password'), current)
  if (next) await user.type(screen.getByLabelText('New password'), next)
  if (confirm) await user.type(screen.getByLabelText('Confirm new password'), confirm)
}

function submit(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole('button', { name: 'Change password' }))
}

describe('ChangePasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('declares the current and the new password fields for password managers', () => {
    render(<ChangePasswordForm />)

    expect(screen.getByLabelText('Current password')).toHaveAttribute(
      'autocomplete',
      'current-password',
    )
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute(
      'autocomplete',
      'new-password',
    )
  })

  // No `maxLength`: the browser cuts a pasted longer password silently, and
  // sign-in, which has no cap, then rejects it. The server error shows
  // `errors.auth.passwordTooLong` instead (HON-1142).
  it('does not cap the length of the new password fields', () => {
    render(<ChangePasswordForm />)

    expect(screen.getByLabelText('New password')).not.toHaveAttribute('maxlength')
    expect(screen.getByLabelText('Confirm new password')).not.toHaveAttribute('maxlength')
  })

  it('shows the sign-up password hint under the new password', () => {
    render(<ChangePasswordForm />)

    expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(
      'Use at least 12 characters. Avoid passwords from past data breaches.',
    )
  })

  describe('client checks, before any request', () => {
    it('rejects an empty current password', async () => {
      const user = userEvent.setup()
      render(<ChangePasswordForm />)

      await fillIn(user, { current: '' })
      await submit(user)

      expect(screen.getByRole('alert')).toHaveTextContent('Enter your current password.')
      expect(authClient.changePassword).not.toHaveBeenCalled()
    })

    it('rejects new passwords that do not match, with the reset-form copy', async () => {
      const user = userEvent.setup()
      render(<ChangePasswordForm />)

      await fillIn(user, { confirm: 'something-else-1234' })
      await submit(user)

      expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match')
      expect(authClient.changePassword).not.toHaveBeenCalled()
    })

    it('rejects a new password under 12 characters, with the reset-form copy', async () => {
      const user = userEvent.setup()
      render(<ChangePasswordForm />)

      await fillIn(user, { next: 'short-pw', confirm: 'short-pw' })
      await submit(user)

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Password must be at least 12 characters long',
      )
      expect(authClient.changePassword).not.toHaveBeenCalled()
    })
  })

  it('changes the password, signs out other devices, clears the fields and confirms', async () => {
    vi.mocked(authClient.changePassword).mockResolvedValue(ok)
    const user = userEvent.setup()
    render(<ChangePasswordForm />)

    await fillIn(user)
    await submit(user)

    expect(authClient.changePassword).toHaveBeenCalledWith({
      currentPassword: CURRENT,
      newPassword: NEXT,
      revokeOtherSessions: true,
    })
    expect(toast.success).toHaveBeenCalledWith('Password changed. Other devices are signed out.')
    expect(screen.getByLabelText('Current password')).toHaveValue('')
    expect(screen.getByLabelText('New password')).toHaveValue('')
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  describe('server errors render catalog copy', () => {
    it.each([
      ['Invalid password', 'The password you entered is incorrect. Please try again.'],
      [
        'That password appears in known data breaches. Please pick a different one.',
        'That password appears in known data breaches. Please pick a different one.',
      ],
      ['Password too long', 'Use a password of 128 characters or fewer.'],
      ['Too many requests', 'Too many attempts. Please try again in a few minutes.'],
      ['Credential account not found', 'An unexpected error occurred. Please try again.'],
    ])('maps "%s"', async (serverMessage, copy) => {
      vi.mocked(authClient.changePassword).mockResolvedValue(failed(serverMessage))
      const user = userEvent.setup()
      render(<ChangePasswordForm />)

      await fillIn(user)
      await submit(user)

      expect(screen.getByRole('alert')).toHaveTextContent(copy)
      expect(toast.success).not.toHaveBeenCalled()
      // The fields stay filled so the user can correct one of them.
      expect(screen.getByLabelText('New password')).toHaveValue(NEXT)
    })

    it('shows the network copy when the request throws', async () => {
      vi.mocked(authClient.changePassword).mockRejectedValue(new Error('fetch failed'))
      const user = userEvent.setup()
      render(<ChangePasswordForm />)

      await fillIn(user)
      await submit(user)

      expect(screen.getByRole('alert')).toHaveTextContent(/unable to connect to the server/i)
    })
  })

  // The form is disabled while pending, and Chromium blurs the focused
  // control. jsdom does not, so the test drops focus itself.
  it('returns focus to the submit button after a successful change', async () => {
    let settle!: (result: ChangeResult) => void
    vi.mocked(authClient.changePassword).mockImplementation(
      () => new Promise<ChangeResult>((resolve) => (settle = resolve)) as never,
    )
    const user = userEvent.setup()
    render(<ChangePasswordForm />)

    await fillIn(user)
    await submit(user)
    dropFocusToBody()

    await act(async () => settle(ok))

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Change password' })).toHaveFocus()
    })
    expect(toast.success).toHaveBeenCalled()
  })

  it('returns focus to the submit button after a wrong current password', async () => {
    let settle!: (result: ChangeResult) => void
    vi.mocked(authClient.changePassword).mockImplementation(
      () => new Promise<ChangeResult>((resolve) => (settle = resolve)) as never,
    )
    const user = userEvent.setup()
    render(<ChangePasswordForm />)

    await fillIn(user)
    await submit(user)
    expect(screen.getByRole('button', { name: 'Changing password…' })).toBeDisabled()
    expect(screen.getByLabelText('Current password')).toBeDisabled()
    dropFocusToBody()

    await act(async () => settle(failed('Invalid password')))

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Change password' })).toHaveFocus()
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The password you entered is incorrect. Please try again.',
    )
  })
})
