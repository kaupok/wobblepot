/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import SignUpPage from './page'

// Mock Next.js navigation
const mockPush = vi.fn()
const mockRefresh = vi.fn()
const mockGet = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  useSearchParams: () => ({
    get: mockGet,
  }),
}))

// Mock auth client
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signUp: {
      email: vi.fn(),
    },
  },
}))

// Mock error helper
vi.mock('@/lib/auth-errors', () => ({
  getUserFriendlyError: vi.fn((msg) => msg),
}))

describe('SignUpPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue(null)
  })

  describe('rendering', () => {
    it('renders sign up form with heading', () => {
      render(<SignUpPage />)

      expect(screen.getByRole('heading', { name: /sign up/i })).toBeInTheDocument()
    })

    it('renders name input with label', () => {
      render(<SignUpPage />)

      const input = screen.getByLabelText(/name/i)
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'text')
    })

    it('renders email input with label', () => {
      render(<SignUpPage />)

      const input = screen.getByLabelText(/email/i)
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'email')
    })

    it('renders password input with label', () => {
      render(<SignUpPage />)

      const input = screen.getByLabelText(/password/i)
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'password')
    })

    it('renders sign up button', () => {
      render(<SignUpPage />)

      expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument()
    })

    it('renders sign in link without returnUrl by default', () => {
      render(<SignUpPage />)

      const link = screen.getByRole('link', { name: /sign in/i })
      expect(link).toHaveAttribute('href', '/sign-in')
    })

    it('displays description text', () => {
      render(<SignUpPage />)

      expect(screen.getByText(/create a new account to get started/i)).toBeInTheDocument()
    })
  })

  describe('returnUrl functionality', () => {
    it('sign-in link includes returnUrl when present', () => {
      mockGet.mockReturnValue('/settings')

      render(<SignUpPage />)

      const link = screen.getByRole('link', { name: /sign in/i })
      expect(link).toHaveAttribute('href', '/sign-in?returnUrl=%2Fsettings')
    })

    it('sign-in link is plain /sign-in when returnUrl is default /profile', () => {
      mockGet.mockReturnValue('/profile')

      render(<SignUpPage />)

      const link = screen.getByRole('link', { name: /sign in/i })
      expect(link).toHaveAttribute('href', '/sign-in')
    })

    it('navigates to default /profile on successful sign up without returnUrl', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signUp.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      render(<SignUpPage />)

      await user.type(screen.getByLabelText(/name/i), 'Test User')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/password/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await vi.waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/profile')
      })
    })

    it('navigates to returnUrl on successful sign up when provided', async () => {
      mockGet.mockReturnValue('/settings/household')

      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signUp.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      render(<SignUpPage />)

      await user.type(screen.getByLabelText(/name/i), 'Test User')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/password/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await vi.waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/settings/household')
      })
    })

    it('calls router.refresh after navigation', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signUp.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      render(<SignUpPage />)

      await user.type(screen.getByLabelText(/name/i), 'Test User')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/password/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await vi.waitFor(() => {
        expect(mockRefresh).toHaveBeenCalled()
      })
    })
  })

  describe('form submission', () => {
    it('calls authClient.signUp.email with correct data', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signUp.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      render(<SignUpPage />)

      await user.type(screen.getByLabelText(/name/i), 'Test User')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/password/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await vi.waitFor(() => {
        expect(authClient.signUp.email).toHaveBeenCalledWith(
          {
            email: 'test@example.com',
            password: 'password123',
            name: 'Test User',
          },
          {
            onSuccess: expect.any(Function),
            onError: expect.any(Function),
          },
        )
      })
    })

    it('shows error message on sign up failure', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signUp.email).mockImplementation(async (creds, options) => {
        if (options?.onError) {
          options.onError({
            error: {
              message: 'Email already exists',
              status: 400,
              statusText: 'Bad Request',
              name: 'AuthError',
            },
          } as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      render(<SignUpPage />)

      await user.type(screen.getByLabelText(/name/i), 'Test User')
      await user.type(screen.getByLabelText(/email/i), 'existing@example.com')
      await user.type(screen.getByLabelText(/password/i), 'password123')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/email already exists/i)
      })
    })
  })
})
