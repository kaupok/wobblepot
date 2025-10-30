import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import ForgotPasswordPage from './page'

// Mock auth client
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    forgetPassword: vi.fn(),
  },
}))

// Mock error helper
vi.mock('@/lib/auth-errors', () => ({
  getUserFriendlyError: vi.fn((msg) => msg),
}))

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders forgot password form with heading', () => {
      render(<ForgotPasswordPage />)

      expect(screen.getByRole('heading', { name: /forgot password/i })).toBeInTheDocument()
    })

    it('renders email input with label', () => {
      render(<ForgotPasswordPage />)

      expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/email/i)).toHaveAttribute('type', 'email')
      expect(screen.getByLabelText(/email/i)).toHaveAttribute('placeholder', 'you@example.com')
    })

    it('renders send reset link button', () => {
      render(<ForgotPasswordPage />)

      expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument()
    })

    it('renders sign in link', () => {
      render(<ForgotPasswordPage />)

      const link = screen.getByRole('link', { name: /sign in/i })
      expect(link).toHaveAttribute('href', '/sign-in')
    })

    it('displays description text', () => {
      render(<ForgotPasswordPage />)

      expect(
        screen.getByText(/enter your email address and we'll send you a link/i),
      ).toBeInTheDocument()
    })
  })

  describe('form interaction', () => {
    it('updates email input on user type', async () => {
      const user = userEvent.setup()
      render(<ForgotPasswordPage />)

      const emailInput = screen.getByLabelText(/email/i)
      await user.type(emailInput, 'test@example.com')

      expect(emailInput).toHaveValue('test@example.com')
    })

    it('calls authClient.forgetPassword on form submission', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.forgetPassword).mockImplementation(async (payload, options) => {
        if (options?.onSuccess) {
          options.onSuccess()
        }
      })

      const user = userEvent.setup()
      render(<ForgotPasswordPage />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.click(screen.getByRole('button', { name: /send reset link/i }))

      expect(authClient.forgetPassword).toHaveBeenCalledWith(
        {
          email: 'test@example.com',
          redirectTo: '/reset-password',
        },
        {
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        },
      )
    })

    it('disables button and shows loading text during submission', async () => {
      const { authClient } = await import('@/lib/auth-client')

      let resolveSubmit: () => void
      const submitPromise = new Promise<void>((resolve) => {
        resolveSubmit = resolve
      })
      vi.mocked(authClient.forgetPassword).mockReturnValue(submitPromise)

      const user = userEvent.setup()
      render(<ForgotPasswordPage />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.click(screen.getByRole('button', { name: /send reset link/i }))

      await vi.waitFor(() => {
        const button = screen.getByRole('button', { name: /sending reset link/i })
        expect(button).toBeDisabled()
      })

      resolveSubmit!()
      await submitPromise

      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: /send reset link/i })).not.toBeDisabled()
      })
    })
  })

  describe('success state', () => {
    it('shows success message after successful submission', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.forgetPassword).mockImplementation(async (payload, options) => {
        if (options?.onSuccess) {
          options.onSuccess()
        }
      })

      const user = userEvent.setup()
      render(<ForgotPasswordPage />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.click(screen.getByRole('button', { name: /send reset link/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent(
          /if an account exists with this email, you will receive a password reset link/i,
        )
      })
    })

    it('hides form inputs when success state is true', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.forgetPassword).mockImplementation(async (payload, options) => {
        if (options?.onSuccess) {
          options.onSuccess()
        }
      })

      const user = userEvent.setup()
      render(<ForgotPasswordPage />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.click(screen.getByRole('button', { name: /send reset link/i }))

      await vi.waitFor(() => {
        expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /send reset link/i })).not.toBeInTheDocument()
      })
    })

    it('success message includes account enumeration prevention text', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.forgetPassword).mockImplementation(async (payload, options) => {
        if (options?.onSuccess) {
          options.onSuccess()
        }
      })

      const user = userEvent.setup()
      render(<ForgotPasswordPage />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.click(screen.getByRole('button', { name: /send reset link/i }))

      await vi.waitFor(() => {
        const message = screen.getByRole('status')
        expect(message).toHaveTextContent(/if an account exists/i)
        expect(message).toHaveTextContent(/check your console for the mock email/i)
      })
    })
  })

  describe('account enumeration prevention', () => {
    it('shows success message for user not found error', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.forgetPassword).mockImplementation(async (payload, options) => {
        if (options?.onError) {
          options.onError({
            error: { message: 'User not found' },
          })
        }
      })

      const user = userEvent.setup()
      render(<ForgotPasswordPage />)

      await user.type(screen.getByLabelText(/email/i), 'nonexistent@example.com')
      await user.click(screen.getByRole('button', { name: /send reset link/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent(
          /if an account exists with this email/i,
        )
      })
    })

    it('shows success message for email not found error', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.forgetPassword).mockImplementation(async (payload, options) => {
        if (options?.onError) {
          options.onError({
            error: { message: 'Email not found in database' },
          })
        }
      })

      const user = userEvent.setup()
      render(<ForgotPasswordPage />)

      await user.type(screen.getByLabelText(/email/i), 'nonexistent@example.com')
      await user.click(screen.getByRole('button', { name: /send reset link/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('status')).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      })
    })

    it('shows success message for no user error', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.forgetPassword).mockImplementation(async (payload, options) => {
        if (options?.onError) {
          options.onError({
            error: { message: 'No user exists' },
          })
        }
      })

      const user = userEvent.setup()
      render(<ForgotPasswordPage />)

      await user.type(screen.getByLabelText(/email/i), 'nonexistent@example.com')
      await user.click(screen.getByRole('button', { name: /send reset link/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('status')).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      })
    })

    it('shows success message for not found error', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.forgetPassword).mockImplementation(async (payload, options) => {
        if (options?.onError) {
          options.onError({
            error: { message: 'Account not found' },
          })
        }
      })

      const user = userEvent.setup()
      render(<ForgotPasswordPage />)

      await user.type(screen.getByLabelText(/email/i), 'nonexistent@example.com')
      await user.click(screen.getByRole('button', { name: /send reset link/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('status')).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      })
    })
  })

  describe('error handling', () => {
    it('shows error message for network errors', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.forgetPassword).mockImplementation(async (payload, options) => {
        if (options?.onError) {
          options.onError({
            error: { message: 'Network error occurred' },
          })
        }
      })

      const user = userEvent.setup()
      render(<ForgotPasswordPage />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.click(screen.getByRole('button', { name: /send reset link/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/network error/i)
      })
    })

    it('shows error message for rate limiting', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.forgetPassword).mockImplementation(async (payload, options) => {
        if (options?.onError) {
          options.onError({
            error: { message: 'Too many requests' },
          })
        }
      })

      const user = userEvent.setup()
      render(<ForgotPasswordPage />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.click(screen.getByRole('button', { name: /send reset link/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/too many requests/i)
      })
    })

    it('handles thrown exceptions', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.forgetPassword).mockRejectedValue(new Error('Connection failed'))

      const user = userEvent.setup()
      render(<ForgotPasswordPage />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.click(screen.getByRole('button', { name: /send reset link/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/connection failed/i)
      })
    })
  })

  describe('reset state', () => {
    it('clears error when form is resubmitted', async () => {
      const { authClient } = await import('@/lib/auth-client')

      // First submission fails
      vi.mocked(authClient.forgetPassword).mockImplementationOnce(async (payload, options) => {
        if (options?.onError) {
          options.onError({
            error: { message: 'Network error' },
          })
        }
      })

      const user = userEvent.setup()
      render(<ForgotPasswordPage />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.click(screen.getByRole('button', { name: /send reset link/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })

      // Second submission succeeds
      vi.mocked(authClient.forgetPassword).mockImplementationOnce(async (payload, options) => {
        if (options?.onSuccess) {
          options.onSuccess()
        }
      })

      await user.click(screen.getByRole('button', { name: /send reset link/i }))

      await vi.waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(screen.getByRole('status')).toBeInTheDocument()
      })
    })
  })
})
