/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { act, render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { SignInForm } from './SignInForm'
import { dropFocusToBody } from '@/test/focus'

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
      social: vi.fn(),
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
    // clearAllMocks keeps implementations, and 'handles navigation errors
    // gracefully' makes push throw; later tests need it to navigate.
    mockPush.mockReset()
    mockGet.mockReturnValue(null)
    mockSearchParamsToString.mockReturnValue('')
  })

  describe('rendering', () => {
    it('renders sign in form with heading', () => {
      render(<SignInForm />)

      expect(screen.getByRole('heading', { level: 1, name: /sign in/i })).toBeInTheDocument()
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

    // Password managers match a saved login on `autocomplete` + `name`; WCAG 1.3.5.
    it('declares the autofill purpose of each field', () => {
      render(<SignInForm />)

      const email = screen.getByLabelText(/email/i)
      expect(email).toHaveAttribute('name', 'email')
      expect(email).toHaveAttribute('autocomplete', 'username')

      const password = screen.getByLabelText(/^password$/i)
      expect(password).toHaveAttribute('name', 'password')
      expect(password).toHaveAttribute('autocomplete', 'current-password')
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

  // HON-1162: sign-up drops an MCP client's signed OAuth query, so a new user
  // is told to set up first and connect again.
  describe('connector sign-up note', () => {
    const note = /then start connecting again from the app/i

    it('is hidden on a plain sign-in', () => {
      render(<SignInForm />)

      expect(screen.queryByText(note)).not.toBeInTheDocument()
    })

    it('shows under the sign up link during an OAuth request', () => {
      render(<SignInForm isOAuthRequest />)

      expect(screen.getByText(note)).toBeInTheDocument()
      // The link itself is unchanged: it keeps only `returnUrl`.
      expect(screen.getByRole('link', { name: /sign up/i })).toHaveAttribute('href', '/sign-up')
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

    it('leaves navigation to the auth client when the OAuth flow answers with a redirect', async () => {
      // Inside an MCP client's authorization the provider's after-hook returns
      // the consent URL, and Better Auth's redirect plugin navigates to it
      // (HON-1150). Pushing returnUrl as well would race that navigation.
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signIn.email).mockImplementation(async (creds, options) => {
        options?.onSuccess?.({
          data: { redirect: true, url: '/consent?client_id=abc&sig=xyz' },
        } as any)
      })

      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await vi.waitFor(() => expect(authClient.signIn.email).toHaveBeenCalled())
      expect(mockPush).not.toHaveBeenCalled()
      expect(mockRefresh).not.toHaveBeenCalled()
      // The form stays disabled while the browser leaves the page.
      expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled()
    })

    it('pushes returnUrl after a plain sign-in, which answers redirect: false', async () => {
      const { authClient } = await import('@/lib/auth-client')
      mockGet.mockImplementation((key: string) => (key === 'returnUrl' ? '/pantry' : null))
      vi.mocked(authClient.signIn.email).mockImplementation(async (creds, options) => {
        options?.onSuccess?.({ data: { redirect: false, token: 't' } } as any)
      })

      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await vi.waitFor(() => expect(mockPush).toHaveBeenCalledWith('/pantry'))
    })

    // Better Auth resolves the request promise as soon as the server answers,
    // after firing exactly one of onSuccess / onError. The mock below mirrors
    // that: it holds the promise open, then settles it through onError so the
    // tests exercise the real re-enable path.
    function mockDeferredSignIn() {
      let settle!: () => void
      const settled = new Promise<void>((resolve) => {
        settle = resolve
      })
      let callbacks: any
      const signInPromise = settled.then(() => {
        callbacks?.onError?.({
          error: { message: 'Invalid credentials', status: 401 },
        })
      })
      return {
        mock: vi.fn((creds: unknown, options: unknown) => {
          callbacks = options
          return signInPromise
        }),
        settle: async () => {
          settle()
          await signInPromise
        },
      }
    }

    it('disables button and shows loading text during submission', async () => {
      const { authClient } = await import('@/lib/auth-client')
      const deferred = mockDeferredSignIn()
      vi.mocked(authClient.signIn.email).mockImplementation(deferred.mock as any)

      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await vi.waitFor(() => {
        const button = screen.getByRole('button', { name: /signing in/i })
        expect(button).toBeDisabled()
      })

      await deferred.settle()

      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: /^sign in$/i })).not.toBeDisabled()
      })
    })

    it('disables inputs during submission', async () => {
      const { authClient } = await import('@/lib/auth-client')
      const deferred = mockDeferredSignIn()
      vi.mocked(authClient.signIn.email).mockImplementation(deferred.mock as any)

      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await vi.waitFor(() => {
        expect(screen.getByLabelText(/email/i)).toBeDisabled()
        expect(screen.getByLabelText(/^password$/i)).toBeDisabled()
      })

      await deferred.settle()

      await vi.waitFor(() => {
        expect(screen.getByLabelText(/email/i)).not.toBeDisabled()
        expect(screen.getByLabelText(/^password$/i)).not.toBeDisabled()
      })
    })

    // The request promise resolves before router.push has fetched and rendered
    // the new route, so re-enabling here made the button flicker back to
    // "Sign in" for about a second before the page changed. Once navigation
    // has started the form must stay disabled until it unmounts.
    it('keeps the form disabled after a successful sign in while navigating', async () => {
      const { authClient } = await import('@/lib/auth-client')
      // Fire onSuccess inside the async implementation rather than through the
      // deferred helper: user.click then flushes the whole handler, including
      // the finally block, before the assertions below run. With the deferred
      // mock the assertions raced the re-render and passed without the fix.
      vi.mocked(authClient.signIn.email).mockImplementation((async (
        _creds: unknown,
        options: any,
      ) => {
        options?.onSuccess?.({})
      }) as any)

      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await vi.waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
      })
      expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled()
      expect(screen.getByLabelText(/email/i)).toBeDisabled()
      expect(screen.getByLabelText(/^password$/i)).toBeDisabled()
    })

    it('re-enables the form when the request throws', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signIn.email).mockRejectedValue(new Error('Connection failed'))

      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: /^sign in$/i })).not.toBeDisabled()
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
      // Navigation never started, so the user must be able to retry.
      expect(screen.getByRole('button', { name: /^sign in$/i })).not.toBeDisabled()
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

  // The form is disabled while the request is pending, and Chromium blurs the
  // focused control when it is disabled. After a failure the submit button
  // must take focus back, whether the submit came from it or from Enter in a
  // field (HON-835). jsdom does not blur, so each test drops focus itself.
  describe('focus after submit', () => {
    type Outcome = 'error' | 'throw' | 'success'

    async function deferSignIn() {
      const { authClient } = await import('@/lib/auth-client')
      let settle!: (outcome: Outcome) => void
      vi.mocked(authClient.signIn.email).mockImplementation(
        ((_creds: unknown, options: any) =>
          new Promise<void>((resolve, reject) => {
            settle = (outcome) => {
              if (outcome === 'throw') return reject(new Error('Connection failed'))
              if (outcome === 'error')
                options?.onError?.({ error: { message: 'Invalid credentials' } })
              else options?.onSuccess?.({})
              resolve()
            }
          })) as any,
      )
      return (outcome: Outcome) => act(async () => settle(outcome))
    }

    async function fillIn(user: ReturnType<typeof userEvent.setup>) {
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'wrong-password')
    }

    it('returns focus to the submit button after a failed submit from the button', async () => {
      const settle = await deferSignIn()
      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await fillIn(user)
      await user.click(screen.getByRole('button', { name: /sign in/i }))
      expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled()
      dropFocusToBody()

      await settle('error')

      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: /^sign in$/i })).toHaveFocus()
      })
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid credentials/i)
    })

    it('returns focus to the submit button after a failed submit from Enter in a field', async () => {
      const settle = await deferSignIn()
      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await fillIn(user)
      await user.type(screen.getByLabelText(/^password$/i), '{Enter}')
      expect(screen.getByLabelText(/^password$/i)).toBeDisabled()
      dropFocusToBody()

      await settle('error')

      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: /^sign in$/i })).toHaveFocus()
      })
    })

    it('returns focus to the submit button when the request throws', async () => {
      const settle = await deferSignIn()
      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await fillIn(user)
      await user.click(screen.getByRole('button', { name: /sign in/i }))
      dropFocusToBody()

      await settle('throw')

      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: /^sign in$/i })).toHaveFocus()
      })
    })

    it('does not move focus to the submit button after a successful sign in', async () => {
      const settle = await deferSignIn()
      const user = userEvent.setup({ delay: null })
      render(<SignInForm />)

      await fillIn(user)
      await user.click(screen.getByRole('button', { name: /sign in/i }))
      dropFocusToBody()

      await settle('success')

      expect(mockPush).toHaveBeenCalledWith('/')
      expect(screen.getByRole('button', { name: /signing in/i })).not.toHaveFocus()
      expect(document.body).toHaveFocus()
    })
  })

  describe('Continue with Google (HON-1157)', () => {
    const params = (values: Record<string, string>) => {
      mockGet.mockImplementation((key: string) => values[key] ?? null)
      mockSearchParamsToString.mockReturnValue(new URLSearchParams(values).toString())
    }

    it('is hidden when Google sign-in is not configured', () => {
      render(<SignInForm />)

      expect(screen.queryByRole('button', { name: /continue with google/i })).toBeNull()
      expect(screen.queryByText('or')).toBeNull()
    })

    it('starts a Google sign-in that cannot create an account', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signIn.social).mockResolvedValue({ data: {}, error: null } as any)
      params({ returnUrl: '/pantry' })
      const user = userEvent.setup({ delay: null })
      render(<SignInForm googleEnabled />)

      await user.click(screen.getByRole('button', { name: /continue with google/i }))

      expect(authClient.signIn.social).toHaveBeenCalledWith({
        provider: 'google',
        callbackURL: '/pantry',
        errorCallbackURL: '/sign-in?returnUrl=%2Fpantry',
      })
      expect(vi.mocked(authClient.signIn.social).mock.calls[0]![0]).not.toHaveProperty(
        'requestSignUp',
      )
      // The page is leaving for Google: the button stays busy.
      expect(screen.getByRole('button', { name: /opening google/i })).toBeDisabled()
    })

    it('shows the refusal and returns focus to the button when the request fails', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signIn.social).mockResolvedValue({
        data: null,
        error: { message: 'Too many requests' },
      } as any)
      const user = userEvent.setup({ delay: null })
      render(<SignInForm googleEnabled />)

      await user.click(screen.getByRole('button', { name: /continue with google/i }))

      expect(screen.getByRole('alert')).toHaveTextContent('Too many requests')
      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: /continue with google/i })).toHaveFocus()
      })
    })

    it('shows the no-account copy with a sign-up link, and clears the code from the URL', () => {
      params({ returnUrl: '/pantry', error: 'signup_disabled' })

      render(<SignInForm googleEnabled />)

      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('No Wobblepot account uses this Google account yet.')
      expect(within(alert).getByRole('link', { name: 'Sign up' })).toHaveAttribute(
        'href',
        '/sign-up?returnUrl=%2Fpantry',
      )
      expect(mockReplace).toHaveBeenCalledWith('/sign-in?returnUrl=%2Fpantry')
    })

    it('tells an unverified password user to verify first', () => {
      params({ error: 'account_not_linked' })

      render(<SignInForm googleEnabled />)

      expect(screen.getByRole('alert')).toHaveTextContent(
        /Sign in with your password and verify your email on My account/,
      )
      expect(within(screen.getByRole('alert')).queryByRole('link')).toBeNull()
      expect(mockReplace).toHaveBeenCalledWith('/sign-in')
    })

    it('keeps the signed MCP query when it clears the code', () => {
      params({ client_id: 'client-123', sig: 'signature-abc', error: 'access_denied' })

      render(<SignInForm googleEnabled isOAuthRequest />)

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Signing in with Google did not work. Please try again.',
      )
      expect(mockReplace).toHaveBeenCalledWith('/sign-in?client_id=client-123&sig=signature-abc')
    })
  })
})
