/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { SignInForm } from './SignInForm'

// Mock Next.js navigation
const mockPush = vi.fn()
const mockRefresh = vi.fn()
const mockReplace = vi.fn()
const mockGet = vi.fn()
const mockSearchParamsToString = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
    replace: mockReplace,
  }),
  useSearchParams: () => ({
    get: mockGet,
    toString: mockSearchParamsToString,
  }),
}))

// Mock auth client
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signIn: {
      email: vi.fn(),
    },
  },
}))

// Mock the friendly-error hook so tests assert on raw server messages without
// coupling to the localized catalog copy. Catalog → key mapping is exercised
// in src/lib/auth-errors.test.ts.
vi.mock('@/lib/auth-errors-client', () => ({
  useAuthErrorMessage: () => (msg: string) => msg,
}))

describe('SignInForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue(null)
    mockSearchParamsToString.mockReturnValue('')
  })

  describe('rendering', () => {
    it('renders sign in form with heading', () => {
      render(<SignInForm />)

      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    })

    it('renders email input with label', () => {
      render(<SignInForm />)

      const input = screen.getByLabelText(/email/i)
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'email')
    })

    it('renders password input with label', () => {
      render(<SignInForm />)

      const input = screen.getByLabelText(/^password$/i)
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'password')
    })

    it('renders sign in button', () => {
      render(<SignInForm />)

      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    })

    it('renders forgot password link', () => {
      render(<SignInForm />)

      const link = screen.getByRole('link', { name: /forgot password/i })
      expect(link).toHaveAttribute('href', '/forgot-password')
    })

    it('renders sign up link', () => {
      render(<SignInForm />)

      const link = screen.getByRole('link', { name: /sign up/i })
      expect(link).toHaveAttribute('href', '/sign-up')
    })

    it('displays description text', () => {
      render(<SignInForm />)

      expect(screen.getByText(/sign in to your account/i)).toBeInTheDocument()
    })
  })

  describe('URL parameter success message', () => {
    it('shows success message when reset=success in URL', () => {
      mockGet.mockReturnValue('success')

      render(<SignInForm />)

      expect(screen.getByRole('status')).toHaveTextContent(
        /your password has been reset successfully/i,
      )
    })

    it('success message includes instruction to sign in', () => {
      mockGet.mockReturnValue('success')

      render(<SignInForm />)

      expect(screen.getByRole('status')).toHaveTextContent(
        /you can now sign in with your new password/i,
      )
    })

    it('clears URL parameter after showing message', () => {
      mockGet.mockReturnValue('success')
      mockSearchParamsToString.mockReturnValue('reset=success')

      render(<SignInForm />)

      // When reset is the only param, URL should be /sign-in (no query string)
      expect(mockReplace).toHaveBeenCalledWith('/sign-in')
    })

    it('preserves other query params when clearing reset', () => {
      mockGet.mockReturnValue('success')
      mockSearchParamsToString.mockReturnValue('reset=success&returnUrl=%2Fsettings')

      render(<SignInForm />)

      // returnUrl should be preserved after removing reset param
      expect(mockReplace).toHaveBeenCalledWith('/sign-in?returnUrl=%2Fsettings')
    })

    it('success message has role="status" for screen readers', () => {
      mockGet.mockReturnValue('success')

      render(<SignInForm />)

      const status = screen.getByRole('status')
      expect(status).toBeInTheDocument()
    })

    // The `form-success` handle is the E2E contract (HON-582): `role="status"`
    // is also what every Skeleton renders, so forgot-password.spec.ts targets
    // this testid instead. Removing it turns a green unit suite into a red
    // tier-1 E2E run, so pin it here where the cost is one line.
    it('success message carries the form-success test handle', () => {
      mockGet.mockReturnValue('success')

      render(<SignInForm />)

      expect(screen.getByTestId('form-success')).toBe(screen.getByRole('status'))
    })

    it('does not show success message when no reset param in URL', () => {
      mockGet.mockReturnValue(null)

      render(<SignInForm />)

      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    // Note: Success message clearing on user input is tested manually
    // The interaction between mockGet state and onChange handlers is complex in tests
  })

  describe('form interaction', () => {
    it('updates email and password inputs on user type', async () => {
      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      const emailInput = screen.getByLabelText(/email/i)
      const passwordInput = screen.getByLabelText(/^password$/i)

      await user.type(emailInput, 'test@example.com')
      await user.type(passwordInput, 'password123')

      expect(emailInput).toHaveValue('test@example.com')
      expect(passwordInput).toHaveValue('password123')
    })

    it('calls authClient.signIn.email on form submission', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signIn.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await vi.waitFor(() => {
        expect(authClient.signIn.email).toHaveBeenCalledWith(
          {
            email: 'test@example.com',
            password: 'password123',
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

      let resolveSignIn: () => void
      const signInPromise = new Promise<void>((resolve) => {
        resolveSignIn = resolve
      })
      vi.mocked(authClient.signIn.email).mockReturnValue(signInPromise)

      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await vi.waitFor(() => {
        const button = screen.getByRole('button', { name: /signing in/i })
        expect(button).toBeDisabled()
      })

      resolveSignIn!()
      await signInPromise

      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: /^sign in$/i })).not.toBeDisabled()
      })
    })

    it('disables inputs during submission', async () => {
      const { authClient } = await import('@/lib/auth-client')

      let resolveSignIn: () => void
      const signInPromise = new Promise<void>((resolve) => {
        resolveSignIn = resolve
      })
      vi.mocked(authClient.signIn.email).mockReturnValue(signInPromise)

      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await vi.waitFor(() => {
        expect(screen.getByLabelText(/email/i)).toBeDisabled()
        expect(screen.getByLabelText(/^password$/i)).toBeDisabled()
      })

      resolveSignIn!()
      await signInPromise

      await vi.waitFor(() => {
        expect(screen.getByLabelText(/email/i)).not.toBeDisabled()
        expect(screen.getByLabelText(/^password$/i)).not.toBeDisabled()
      })
    })
  })

  describe('success navigation', () => {
    it('navigates to Today dashboard on successful sign in', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signIn.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await vi.waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
      })
    })

    it('calls router.refresh after navigation', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signIn.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await vi.waitFor(() => {
        expect(mockRefresh).toHaveBeenCalled()
      })
    })

    it('handles navigation errors gracefully', async () => {
      const { authClient } = await import('@/lib/auth-client')
      mockPush.mockImplementation(() => {
        throw new Error('Navigation failed')
      })

      vi.mocked(authClient.signIn.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          /authentication successful, but navigation failed/i,
        )
      })
    })
  })

  describe('error handling', () => {
    it('shows error message for invalid credentials', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signIn.email).mockImplementation(async (creds, options) => {
        if (options?.onError) {
          options.onError({
            error: {
              message: 'Invalid credentials',
              status: 401,
              statusText: 'Unauthorized',
              name: 'AuthError',
            },
          } as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'wrong')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/invalid credentials/i)
      })
    })

    it('shows error message for network errors', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signIn.email).mockImplementation(async (creds, options) => {
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

      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/network error/i)
      })
    })

    it('handles thrown exceptions', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signIn.email).mockRejectedValue(new Error('Connection failed'))

      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/connection failed/i)
      })
    })

    it('error has role="alert" for screen readers', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signIn.email).mockImplementation(async (creds, options) => {
        if (options?.onError) {
          options.onError({
            error: {
              message: 'Error occurred',
              status: 500,
              statusText: 'Internal Server Error',
              name: 'Error',
            },
          } as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await vi.waitFor(() => {
        const alert = screen.getByRole('alert')
        expect(alert).toBeInTheDocument()
      })
    })

    it('clears error on resubmission', async () => {
      const { authClient } = await import('@/lib/auth-client')

      // First submission fails
      vi.mocked(authClient.signIn.email).mockImplementationOnce(async (creds, options) => {
        if (options?.onError) {
          options.onError({
            error: {
              message: 'Invalid credentials',
              status: 401,
              statusText: 'Unauthorized',
              name: 'AuthError',
            },
          } as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'wrong')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })

      // Second submission starts (error should clear when form is resubmitted)
      vi.mocked(authClient.signIn.email).mockImplementationOnce(async (creds, options) => {
        // Don't call onSuccess or onError - just let it hang
        return new Promise(() => {})
      })

      await user.clear(screen.getByLabelText(/^password$/i))
      await user.type(screen.getByLabelText(/^password$/i), 'correct')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      // Error should clear immediately when resubmitting
      await vi.waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      })
    })
  })

  // Note: Slow request handling with setTimeout is tested manually
  // The tests with fake timers conflict with userEvent's internal timers
})
