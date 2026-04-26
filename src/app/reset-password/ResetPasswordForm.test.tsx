/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { ResetPasswordForm } from './ResetPasswordForm'

// Mock Next.js navigation
const mockPush = vi.fn()
const mockGet = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useSearchParams: () => ({
    get: mockGet,
  }),
}))

// Mock auth client
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    resetPassword: vi.fn(),
  },
}))

// Mock the friendly-error hook so tests assert on raw server messages without
// coupling to the localized catalog copy. Catalog → key mapping is exercised
// in src/lib/auth-errors.test.ts.
vi.mock('@/lib/auth-errors-client', () => ({
  useAuthErrorMessage: () => (msg: string) => msg,
}))

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue('test-token-123')
  })

  describe('rendering', () => {
    it('renders reset password form with heading', () => {
      render(<ResetPasswordForm />)

      expect(screen.getByRole('heading', { name: /reset password/i })).toBeInTheDocument()
    })

    it('renders new password input with label', () => {
      render(<ResetPasswordForm />)

      const input = screen.getByLabelText(/new password/i)
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'password')
      expect(input).toHaveAttribute('placeholder', 'At least 12 characters')
    })

    it('renders confirm password input with label', () => {
      render(<ResetPasswordForm />)

      const input = screen.getByLabelText(/confirm password/i)
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'password')
      expect(input).toHaveAttribute('placeholder', 'Re-enter your password')
    })

    it('renders reset password button', () => {
      render(<ResetPasswordForm />)

      expect(screen.getByRole('button', { name: /reset password/i })).toBeInTheDocument()
    })

    it('renders sign in link', () => {
      render(<ResetPasswordForm />)

      const link = screen.getByRole('link', { name: /sign in/i })
      expect(link).toHaveAttribute('href', '/sign-in')
    })

    it('displays description text', () => {
      render(<ResetPasswordForm />)

      expect(screen.getByText(/enter your new password below/i)).toBeInTheDocument()
    })
  })

  describe('token extraction', () => {
    it('extracts token from URL on mount', () => {
      mockGet.mockReturnValue('my-reset-token-456')

      render(<ResetPasswordForm />)

      expect(mockGet).toHaveBeenCalledWith('token')
    })

    it('shows error when no token in URL', () => {
      mockGet.mockReturnValue(null)

      render(<ResetPasswordForm />)

      expect(screen.getByRole('alert')).toHaveTextContent(
        /no reset token found. please request a new password reset link/i,
      )
    })

    it('disables form inputs when no token present', () => {
      mockGet.mockReturnValue(null)

      render(<ResetPasswordForm />)

      expect(screen.getByLabelText(/new password/i)).toBeDisabled()
      expect(screen.getByLabelText(/confirm password/i)).toBeDisabled()
    })

    it('disables submit button when no token present', () => {
      mockGet.mockReturnValue(null)

      render(<ResetPasswordForm />)

      expect(screen.getByRole('button', { name: /reset password/i })).toBeDisabled()
    })
  })

  describe('password validation', () => {
    it('shows error when passwords do not match', async () => {
      const user = userEvent.setup()
      render(<ResetPasswordForm />)

      await user.type(screen.getByLabelText(/new password/i), 'password123')
      await user.type(screen.getByLabelText(/confirm password/i), 'different456')
      await user.click(screen.getByRole('button', { name: /reset password/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/passwords do not match/i)
      })
    })

    it('shows error when password is too short', async () => {
      const user = userEvent.setup()
      render(<ResetPasswordForm />)

      await user.type(screen.getByLabelText(/new password/i), 'shortpass11')
      await user.type(screen.getByLabelText(/confirm password/i), 'shortpass11')
      await user.click(screen.getByRole('button', { name: /reset password/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          /password must be at least 12 characters/i,
        )
      })
    })

    it('prevents submission when validation fails', async () => {
      const { authClient } = await import('@/lib/auth-client')
      const user = userEvent.setup()
      render(<ResetPasswordForm />)

      await user.type(screen.getByLabelText(/new password/i), 'password123')
      await user.type(screen.getByLabelText(/confirm password/i), 'different456')
      await user.click(screen.getByRole('button', { name: /reset password/i }))

      expect(authClient.resetPassword).not.toHaveBeenCalled()
    })
  })

  describe('form interaction', () => {
    it('updates password inputs on user type', async () => {
      const user = userEvent.setup()
      render(<ResetPasswordForm />)

      const newPasswordInput = screen.getByLabelText(/new password/i)
      const confirmPasswordInput = screen.getByLabelText(/confirm password/i)

      await user.type(newPasswordInput, 'newpass123456')
      await user.type(confirmPasswordInput, 'newpass123456')

      expect(newPasswordInput).toHaveValue('newpass123456')
      expect(confirmPasswordInput).toHaveValue('newpass123456')
    })

    it('calls authClient.resetPassword on form submission', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.resetPassword).mockImplementation(async (payload, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup()
      render(<ResetPasswordForm />)

      await user.type(screen.getByLabelText(/new password/i), 'newpass123456')
      await user.type(screen.getByLabelText(/confirm password/i), 'newpass123456')
      await user.click(screen.getByRole('button', { name: /reset password/i }))

      await vi.waitFor(() => {
        expect(authClient.resetPassword).toHaveBeenCalledWith(
          {
            newPassword: 'newpass123456',
            token: 'test-token-123',
          },
          {
            onSuccess: expect.any(Function),
            onError: expect.any(Function),
          },
        )
      })
    })

    it('disables button and shows loading text during submission', async () => {
      const { authClient } = await import('@/lib/auth-client')

      let resolveReset: () => void
      const resetPromise = new Promise<void>((resolve) => {
        resolveReset = resolve
      })
      vi.mocked(authClient.resetPassword).mockReturnValue(resetPromise)

      const user = userEvent.setup()
      render(<ResetPasswordForm />)

      await user.type(screen.getByLabelText(/new password/i), 'newpass123456')
      await user.type(screen.getByLabelText(/confirm password/i), 'newpass123456')
      await user.click(screen.getByRole('button', { name: /reset password/i }))

      await vi.waitFor(() => {
        const button = screen.getByRole('button', { name: /resetting password/i })
        expect(button).toBeDisabled()
      })

      resolveReset!()
      await resetPromise

      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: /reset password/i })).not.toBeDisabled()
      })
    })
  })

  describe('success navigation', () => {
    it('redirects to sign-in with success param on successful reset', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.resetPassword).mockImplementation(async (payload, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup()
      render(<ResetPasswordForm />)

      await user.type(screen.getByLabelText(/new password/i), 'newpass123456')
      await user.type(screen.getByLabelText(/confirm password/i), 'newpass123456')
      await user.click(screen.getByRole('button', { name: /reset password/i }))

      await vi.waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/sign-in?reset=success')
      })
    })
  })

  describe('error handling', () => {
    it('shows error message for expired token', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.resetPassword).mockImplementation(async (payload, options) => {
        if (options?.onError) {
          options.onError({
            error: {
              message: 'Token expired',
              status: 400,
              statusText: 'Bad Request',
              name: 'AuthError',
            },
          } as any)
        }
      })

      const user = userEvent.setup()
      render(<ResetPasswordForm />)

      await user.type(screen.getByLabelText(/new password/i), 'newpass123456')
      await user.type(screen.getByLabelText(/confirm password/i), 'newpass123456')
      await user.click(screen.getByRole('button', { name: /reset password/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/token expired/i)
      })
    })

    it('shows error message for invalid token', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.resetPassword).mockImplementation(async (payload, options) => {
        if (options?.onError) {
          options.onError({
            error: {
              message: 'Invalid token',
              status: 400,
              statusText: 'Bad Request',
              name: 'AuthError',
            },
          } as any)
        }
      })

      const user = userEvent.setup()
      render(<ResetPasswordForm />)

      await user.type(screen.getByLabelText(/new password/i), 'newpass123456')
      await user.type(screen.getByLabelText(/confirm password/i), 'newpass123456')
      await user.click(screen.getByRole('button', { name: /reset password/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/invalid token/i)
      })
    })

    it('shows error message for network errors', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.resetPassword).mockImplementation(async (payload, options) => {
        if (options?.onError) {
          options.onError({
            error: {
              message: 'Network error occurred',
              status: 500,
              statusText: 'Internal Server Error',
              name: 'NetworkError',
            },
          } as any)
        }
      })

      const user = userEvent.setup()
      render(<ResetPasswordForm />)

      await user.type(screen.getByLabelText(/new password/i), 'newpass123456')
      await user.type(screen.getByLabelText(/confirm password/i), 'newpass123456')
      await user.click(screen.getByRole('button', { name: /reset password/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/network error/i)
      })
    })

    it('handles thrown exceptions', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.resetPassword).mockRejectedValue(new Error('Connection failed'))

      const user = userEvent.setup()
      render(<ResetPasswordForm />)

      await user.type(screen.getByLabelText(/new password/i), 'newpass123456')
      await user.type(screen.getByLabelText(/confirm password/i), 'newpass123456')
      await user.click(screen.getByRole('button', { name: /reset password/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/connection failed/i)
      })
    })

    it('error has role="alert" for screen readers', async () => {
      mockGet.mockReturnValue(null)

      render(<ResetPasswordForm />)

      const alert = screen.getByRole('alert')
      expect(alert).toBeInTheDocument()
    })
  })
})
