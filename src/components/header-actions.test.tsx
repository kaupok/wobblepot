import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HeaderActions } from './header-actions'
import type { Session } from '@/lib/auth'

// Mock next/navigation
const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}))

// Mock auth client
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signOut: vi.fn(),
  },
}))

// Mock ThemeToggle component
vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => <div data-testid="theme-toggle">ThemeToggle</div>,
}))

describe('HeaderActions', () => {
  const mockSession: Session = {
    session: {
      id: 'session-123',
      userId: '123',
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      token: 'test-token',
      ipAddress: '127.0.0.1',
      userAgent: 'test',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    user: {
      id: '123',
      email: 'test@example.com',
      name: 'Test User',
      emailVerified: false,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering without session', () => {
    it('renders sign-in and sign-up buttons', () => {
      render(<HeaderActions session={null} />)

      expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Sign up' })).toBeInTheDocument()
    })

    it('renders theme toggle', () => {
      render(<HeaderActions session={null} />)

      expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
    })

    it('does not render user menu button', () => {
      render(<HeaderActions session={null} />)

      expect(screen.queryByRole('button', { name: 'User menu' })).not.toBeInTheDocument()
    })

    it('sign-in button links to /sign-in', () => {
      render(<HeaderActions session={null} />)

      const signInLink = screen.getByRole('link', { name: 'Sign in' })
      expect(signInLink).toHaveAttribute('href', '/sign-in')
    })

    it('sign-up button links to /sign-up', () => {
      render(<HeaderActions session={null} />)

      const signUpLink = screen.getByRole('link', { name: 'Sign up' })
      expect(signUpLink).toHaveAttribute('href', '/sign-up')
    })
  })

  describe('rendering with session', () => {
    it('renders user menu button', () => {
      render(<HeaderActions session={mockSession} />)

      expect(screen.getByRole('button', { name: 'User menu' })).toBeInTheDocument()
    })

    it('renders theme toggle', () => {
      render(<HeaderActions session={mockSession} />)

      expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
    })

    it('does not render sign-in or sign-up buttons', () => {
      render(<HeaderActions session={mockSession} />)

      expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Sign up' })).not.toBeInTheDocument()
    })

    it('shows dropdown with Profile and Sign out when user menu is clicked', async () => {
      const user = userEvent.setup()
      render(<HeaderActions session={mockSession} />)

      const userMenuButton = screen.getByRole('button', { name: 'User menu' })
      await user.click(userMenuButton)

      expect(screen.getByRole('menuitem', { name: 'Profile' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
    })

    it('Profile link points to /profile', async () => {
      const user = userEvent.setup()
      render(<HeaderActions session={mockSession} />)

      const userMenuButton = screen.getByRole('button', { name: 'User menu' })
      await user.click(userMenuButton)

      const profileLink = screen.getByRole('menuitem', { name: 'Profile' })
      expect(profileLink).toHaveAttribute('href', '/profile')
    })
  })

  describe('sign-out functionality', () => {
    it('calls authClient.signOut when sign-out is clicked', async () => {
      const user = userEvent.setup()
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signOut).mockResolvedValue(undefined)

      render(<HeaderActions session={mockSession} />)

      // Open dropdown
      const userMenuButton = screen.getByRole('button', { name: 'User menu' })
      await user.click(userMenuButton)

      // Click sign out
      const signOutButton = screen.getByRole('menuitem', { name: 'Sign out' })
      await user.click(signOutButton)

      expect(authClient.signOut).toHaveBeenCalledTimes(1)
      expect(authClient.signOut).toHaveBeenCalledWith({
        fetchOptions: expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      })
    })

    it('calls router.push and router.refresh on successful sign-out', async () => {
      const user = userEvent.setup()
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signOut).mockImplementation(async (options) => {
        // Simulate successful sign-out by calling onSuccess
        if (options?.fetchOptions?.onSuccess) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          options.fetchOptions.onSuccess({} as any)
        }
      })

      render(<HeaderActions session={mockSession} />)

      // Open dropdown
      const userMenuButton = screen.getByRole('button', { name: 'User menu' })
      await user.click(userMenuButton)

      // Click sign out
      const signOutButton = screen.getByRole('menuitem', { name: 'Sign out' })
      await user.click(signOutButton)

      await vi.waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
        expect(mockRefresh).toHaveBeenCalled()
      })
    })

    it('handles sign-out errors gracefully', async () => {
      const user = userEvent.setup()
      const { authClient } = await import('@/lib/auth-client')
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const testError = {
        message: 'Sign-out failed',
        status: 500,
        statusText: 'Internal Server Error',
        error: 'Sign-out failed',
        name: 'BetterFetchError',
      }

      vi.mocked(authClient.signOut).mockImplementation(async (options) => {
        // Simulate sign-out error
        if (options?.fetchOptions?.onError) {
          options.fetchOptions.onError({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            error: testError as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            response: {} as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            request: {} as any,
          })
        }
      })

      render(<HeaderActions session={mockSession} />)

      // Open dropdown
      const userMenuButton = screen.getByRole('button', { name: 'User menu' })
      await user.click(userMenuButton)

      // Click sign out
      const signOutButton = screen.getByRole('menuitem', { name: 'Sign out' })
      await user.click(signOutButton)

      await vi.waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Sign-out failed:', testError)
      })

      consoleErrorSpy.mockRestore()
    })

    it('handles sign-out exceptions gracefully', async () => {
      const user = userEvent.setup()
      const { authClient } = await import('@/lib/auth-client')
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const testError = new Error('Network error')

      vi.mocked(authClient.signOut).mockRejectedValue(testError)

      render(<HeaderActions session={mockSession} />)

      // Open dropdown
      const userMenuButton = screen.getByRole('button', { name: 'User menu' })
      await user.click(userMenuButton)

      // Click sign out
      const signOutButton = screen.getByRole('menuitem', { name: 'Sign out' })
      await user.click(signOutButton)

      await vi.waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Sign-out exception:', testError)
      })

      consoleErrorSpy.mockRestore()
    })

    it('handles navigation errors after sign-out', async () => {
      const user = userEvent.setup()
      const { authClient } = await import('@/lib/auth-client')
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const navError = new Error('Navigation failed')

      mockPush.mockImplementation(() => {
        throw navError
      })

      vi.mocked(authClient.signOut).mockImplementation(async (options) => {
        if (options?.fetchOptions?.onSuccess) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          options.fetchOptions.onSuccess({} as any)
        }
      })

      render(<HeaderActions session={mockSession} />)

      // Open dropdown
      const userMenuButton = screen.getByRole('button', { name: 'User menu' })
      await user.click(userMenuButton)

      // Click sign out
      const signOutButton = screen.getByRole('menuitem', { name: 'Sign out' })
      await user.click(signOutButton)

      await vi.waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Navigation failed after sign-out:', navError)
      })

      consoleErrorSpy.mockRestore()
    })
  })
})
