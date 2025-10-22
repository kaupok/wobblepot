import { render, screen } from '@testing-library/react'
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

    it('does not render sign-out button', () => {
      render(<HeaderActions session={null} />)

      expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
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
    it('renders sign-out button', () => {
      render(<HeaderActions session={mockSession} />)

      expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
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
  })

  describe('sign-out functionality', () => {
    it('calls authClient.signOut when sign-out button is clicked', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signOut).mockResolvedValue(undefined)

      render(<HeaderActions session={mockSession} />)
      const signOutButton = screen.getByRole('button', { name: 'Sign out' })

      signOutButton.click()

      expect(authClient.signOut).toHaveBeenCalledTimes(1)
      expect(authClient.signOut).toHaveBeenCalledWith({
        fetchOptions: expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      })
    })

    it('shows loading state during sign-out', async () => {
      const { authClient } = await import('@/lib/auth-client')

      // Create a promise we can control
      let resolveSignOut: () => void
      const signOutPromise = new Promise<void>((resolve) => {
        resolveSignOut = resolve
      })
      vi.mocked(authClient.signOut).mockReturnValue(signOutPromise)

      render(<HeaderActions session={mockSession} />)
      const signOutButton = screen.getByRole('button', { name: 'Sign out' })

      signOutButton.click()

      // Wait for loading state to appear
      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: 'Signing out...' })).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: 'Signing out...' })).toBeDisabled()

      // Resolve the sign-out
      resolveSignOut!()
      await signOutPromise

      // Wait for button to return to normal state
      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
      })
    })

    it('calls router.push and router.refresh on successful sign-out', async () => {
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signOut).mockImplementation(async ({ fetchOptions }) => {
        // Simulate successful sign-out by calling onSuccess
        if (fetchOptions?.onSuccess) {
          fetchOptions.onSuccess()
        }
      })

      render(<HeaderActions session={mockSession} />)
      const signOutButton = screen.getByRole('button', { name: 'Sign out' })

      signOutButton.click()

      await vi.waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
        expect(mockRefresh).toHaveBeenCalled()
      })
    })

    it('handles sign-out errors gracefully', async () => {
      const { authClient } = await import('@/lib/auth-client')
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const testError = { message: 'Sign-out failed' }

      vi.mocked(authClient.signOut).mockImplementation(async ({ fetchOptions }) => {
        // Simulate sign-out error
        if (fetchOptions?.onError) {
          fetchOptions.onError({ error: testError })
        }
      })

      render(<HeaderActions session={mockSession} />)
      const signOutButton = screen.getByRole('button', { name: 'Sign out' })

      signOutButton.click()

      await vi.waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Sign-out failed:', testError)
      })

      consoleErrorSpy.mockRestore()
    })

    it('handles sign-out exceptions gracefully', async () => {
      const { authClient } = await import('@/lib/auth-client')
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const testError = new Error('Network error')

      vi.mocked(authClient.signOut).mockRejectedValue(testError)

      render(<HeaderActions session={mockSession} />)
      const signOutButton = screen.getByRole('button', { name: 'Sign out' })

      signOutButton.click()

      await vi.waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Sign-out exception:', testError)
      })

      consoleErrorSpy.mockRestore()
    })

    it('handles navigation errors after sign-out', async () => {
      const { authClient } = await import('@/lib/auth-client')
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const navError = new Error('Navigation failed')

      mockPush.mockImplementation(() => {
        throw navError
      })

      vi.mocked(authClient.signOut).mockImplementation(async ({ fetchOptions }) => {
        if (fetchOptions?.onSuccess) {
          fetchOptions.onSuccess()
        }
      })

      render(<HeaderActions session={mockSession} />)
      const signOutButton = screen.getByRole('button', { name: 'Sign out' })

      signOutButton.click()

      await vi.waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Navigation failed after sign-out:', navError)
      })

      consoleErrorSpy.mockRestore()
    })
  })
})
