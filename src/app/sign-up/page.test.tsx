/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { SignUpForm } from './SignUpForm'

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

// Mock the friendly-error hook so tests assert on raw server messages without
// coupling to the localized catalog copy. Catalog → key mapping is exercised
// in src/lib/auth-errors.test.ts.
vi.mock('@/lib/auth-errors-client', () => ({
  useAuthErrorMessage: () => (msg: string) => msg,
}))

const FORM_PROPS = {
  inviteRequired: false,
  privateBetaBanner: 'Private beta — sign-up is by invite code only.',
  inviteCodeLabel: 'Invite code',
  inviteCodeHint: 'Paste the code from your invitation.',
} as const

describe('SignUpForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue(null)
  })

  describe('rendering (open sign-up — flag off)', () => {
    it('renders sign up form with heading', () => {
      render(<SignUpForm {...FORM_PROPS} />)

      expect(screen.getByRole('heading', { name: /sign up/i })).toBeInTheDocument()
    })

    it('renders name input with label', () => {
      render(<SignUpForm {...FORM_PROPS} />)

      const input = screen.getByLabelText(/name/i)
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'text')
    })

    it('renders email input with label', () => {
      render(<SignUpForm {...FORM_PROPS} />)

      const input = screen.getByLabelText(/email/i)
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'email')
    })

    it('renders password input with label', () => {
      render(<SignUpForm {...FORM_PROPS} />)

      const input = screen.getByLabelText('Password')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'password')
    })

    it('renders sign up button', () => {
      render(<SignUpForm {...FORM_PROPS} />)

      expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument()
    })

    it('renders sign in link without returnUrl by default', () => {
      render(<SignUpForm {...FORM_PROPS} />)

      const link = screen.getByRole('link', { name: /sign in/i })
      expect(link).toHaveAttribute('href', '/sign-in')
    })

    it('displays description text', () => {
      render(<SignUpForm {...FORM_PROPS} />)

      expect(screen.getByText(/create a new account to get started/i)).toBeInTheDocument()
    })

    it('does not render the private-beta banner or invite-code field', () => {
      render(<SignUpForm {...FORM_PROPS} />)

      expect(screen.queryByLabelText(/invite code/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/private beta/i)).not.toBeInTheDocument()
    })
  })

  describe('rendering (invite-only — flag on)', () => {
    const inviteProps = { ...FORM_PROPS, inviteRequired: true }

    it('renders the private-beta banner when inviteRequired is true', () => {
      render(<SignUpForm {...inviteProps} />)
      expect(screen.getByText(/private beta — sign-up is by invite code only/i)).toBeInTheDocument()
    })

    it('renders the invite-code input when inviteRequired is true', () => {
      render(<SignUpForm {...inviteProps} />)

      const input = screen.getByLabelText('Invite code')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'text')
      expect(input).toBeRequired()
    })
  })

  describe('returnUrl functionality', () => {
    it('sign-in link includes returnUrl when present', () => {
      mockGet.mockReturnValue('/household')

      render(<SignUpForm {...FORM_PROPS} />)

      const link = screen.getByRole('link', { name: /sign in/i })
      expect(link).toHaveAttribute('href', '/sign-in?returnUrl=%2Fhousehold')
    })

    it('sign-in link is plain /sign-in when returnUrl is default /', () => {
      mockGet.mockReturnValue('/')

      render(<SignUpForm {...FORM_PROPS} />)

      const link = screen.getByRole('link', { name: /sign in/i })
      expect(link).toHaveAttribute('href', '/sign-in')
    })

    it('navigates to default / on successful sign up without returnUrl', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signUp.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      render(<SignUpForm {...FORM_PROPS} />)

      await user.type(screen.getByLabelText(/name/i), 'Test User')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await vi.waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
      })
    })

    it('navigates to returnUrl on successful sign up when provided', async () => {
      mockGet.mockReturnValue('/household/household')

      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signUp.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      render(<SignUpForm {...FORM_PROPS} />)

      await user.type(screen.getByLabelText(/name/i), 'Test User')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await vi.waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/household/household')
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
      render(<SignUpForm {...FORM_PROPS} />)

      await user.type(screen.getByLabelText(/name/i), 'Test User')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await vi.waitFor(() => {
        expect(mockRefresh).toHaveBeenCalled()
      })
    })
  })

  describe('form submission', () => {
    it('calls authClient.signUp.email with the basic fields when invite gate is off', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signUp.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      render(<SignUpForm {...FORM_PROPS} />)

      await user.type(screen.getByLabelText(/name/i), 'Test User')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
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

    it('passes inviteCode in the payload when invite gate is on', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signUp.email).mockImplementation(async (creds, options) => {
        if (options?.onSuccess) {
          options.onSuccess({} as any)
        }
      })

      const user = userEvent.setup({ delay: null })
      render(<SignUpForm {...FORM_PROPS} inviteRequired />)

      await user.type(screen.getByLabelText(/name/i), 'Test User')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.type(screen.getByLabelText('Invite code'), 'beta-001')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await vi.waitFor(() => {
        expect(authClient.signUp.email).toHaveBeenCalledWith(
          {
            email: 'test@example.com',
            password: 'password123',
            name: 'Test User',
            inviteCode: 'beta-001',
          },
          expect.any(Object),
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
      render(<SignUpForm {...FORM_PROPS} />)

      await user.type(screen.getByLabelText(/name/i), 'Test User')
      await user.type(screen.getByLabelText(/email/i), 'existing@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/email already exists/i)
      })
    })
  })
})
