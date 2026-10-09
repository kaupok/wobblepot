import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { authClient } from '@/lib/auth-client'
import { dropFocusToBody } from '@/test/focus'
import { ProfileNameForm } from './ProfileNameForm'

const mockRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: { updateUser: vi.fn() },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

type UpdateResult = Awaited<ReturnType<typeof authClient.updateUser>>

const ok = { data: { status: true }, error: null } as unknown as UpdateResult
const failed = {
  data: null,
  error: { message: 'Something broke', status: 500 },
} as unknown as UpdateResult

describe('ProfileNameForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('shows the current account name in the field', () => {
    render(<ProfileNameForm initialName="Mari Maasikas" />)

    expect(screen.getByLabelText('Name')).toHaveValue('Mari Maasikas')
  })

  it('saves the trimmed name, confirms with a toast and refreshes the page', async () => {
    vi.mocked(authClient.updateUser).mockResolvedValue(ok)
    const user = userEvent.setup()
    render(<ProfileNameForm initialName="Mari" />)

    const field = screen.getByLabelText('Name')
    await user.clear(field)
    await user.type(field, '  Mari Maasikas  ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(authClient.updateUser).toHaveBeenCalledWith({ name: 'Mari Maasikas' })
    expect(toast.success).toHaveBeenCalledWith('Name saved')
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(field).toHaveValue('Mari Maasikas')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the catalog error for an empty name and makes no request', async () => {
    const user = userEvent.setup()
    render(<ProfileNameForm initialName="Mari" />)

    const field = screen.getByLabelText('Name')
    await user.clear(field)
    await user.type(field, '   ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name.')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAttribute('aria-describedby', 'account-name-error')
    expect(authClient.updateUser).not.toHaveBeenCalled()
  })

  it('caps the field at 100 characters', () => {
    render(<ProfileNameForm initialName="Mari" />)

    expect(screen.getByLabelText('Name')).toHaveAttribute('maxLength', '100')
  })

  it('shows catalog copy, not the server string, when the save fails', async () => {
    vi.mocked(authClient.updateUser).mockResolvedValue(failed)
    const user = userEvent.setup()
    render(<ProfileNameForm initialName="Mari" />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Your name was not saved. Try again.')
    expect(screen.queryByText('Something broke')).not.toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('shows catalog copy when the request throws', async () => {
    vi.mocked(authClient.updateUser).mockRejectedValue(new Error('fetch failed'))
    const user = userEvent.setup()
    render(<ProfileNameForm initialName="Mari" />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Your name was not saved. Try again.')
  })

  // The field and button are disabled while pending, and Chromium blurs the
  // focused control. jsdom does not, so the test drops focus itself.
  // The page does not navigate after a save, so success needs the refocus too
  // (PR #1202 review).
  it.each([
    ['a failure', failed],
    ['a success', ok],
  ])(
    'disables the form while saving and returns focus to Save after %s',
    async (_label, result) => {
      let settle!: (result: UpdateResult) => void
      vi.mocked(authClient.updateUser).mockImplementation(
        () => new Promise<UpdateResult>((resolve) => (settle = resolve)) as never,
      )
      const user = userEvent.setup()
      render(<ProfileNameForm initialName="Mari" />)

      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
      expect(screen.getByLabelText('Name')).toBeDisabled()
      dropFocusToBody()

      await act(async () => settle(result))

      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
      })
    },
  )
})
