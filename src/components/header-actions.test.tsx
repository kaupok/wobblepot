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

// Mock next-themes
const mockSetTheme = vi.fn()
vi.mock('next-themes', () => ({
  useTheme: () => ({
    resolvedTheme: 'light',
    setTheme: mockSetTheme,
  }),
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
      render(<HeaderActions session={null} hasHousehold={false} />)

      expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Sign up' })).toBeInTheDocument()
    })

    it('renders theme toggle', () => {
      render(<HeaderActions session={null} hasHousehold={false} />)

      expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
    })

    it('does not render user menu button', () => {
      render(<HeaderActions session={null} hasHousehold={false} />)

      expect(screen.queryByRole('button', { name: 'User menu' })).not.toBeInTheDocument()
    })

    it('sign-in button links to /sign-in', () => {
      render(<HeaderActions session={null} hasHousehold={false} />)

      const signInLink = screen.getByRole('link', { name: 'Sign in' })
      expect(signInLink).toHaveAttribute('href', '/sign-in')
    })

    it('sign-up button links to /sign-up', () => {
      render(<HeaderActions session={null} hasHousehold={false} />)

      const signUpLink = screen.getByRole('link', { name: 'Sign up' })
      expect(signUpLink).toHaveAttribute('href', '/sign-up')
    })
  })

  describe('rendering with session and household', () => {
    it('renders user menu button', () => {
      render(<HeaderActions session={mockSession} hasHousehold={true} />)

      expect(screen.getByRole('button', { name: 'User menu' })).toBeInTheDocument()
    })

    it('does not render standalone theme toggle', () => {
      render(<HeaderActions session={mockSession} hasHousehold={true} />)

      expect(screen.queryByTestId('theme-toggle')).not.toBeInTheDocument()
    })

    it('does not render sign-in or sign-up buttons', () => {
      render(<HeaderActions session={mockSession} hasHousehold={true} />)

      expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Sign up' })).not.toBeInTheDocument()
    })

    it('shows dropdown with Profile, Sign out, and theme toggle when user menu is clicked', async () => {
      const user = userEvent.setup()
      render(<HeaderActions session={mockSession} hasHousehold={true} />)

      const userMenuButton = screen.getByRole('button', { name: 'User menu' })
      await user.click(userMenuButton)

      expect(screen.getByRole('menuitem', { name: 'Profile' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /dark mode/i })).toBeInTheDocument()
    })

    it('Profile link points to /profile', async () => {
      const user = userEvent.setup()
      render(<HeaderActions session={mockSession} hasHousehold={true} />)

      const userMenuButton = screen.getByRole('button', { name: 'User menu' })
      await user.click(userMenuButton)

      const profileLink = screen.getByRole('menuitem', { name: 'Profile' })
      expect(profileLink).toHaveAttribute('href', '/profile')
    })
  })

  describe('rendering with session but no household (onboarding)', () => {
    it('renders user menu button', () => {
      render(<HeaderActions session={mockSession} hasHousehold={false} />)

      expect(screen.getByRole('button', { name: 'User menu' })).toBeInTheDocument()
    })

    it('hides Profile link in dropdown', async () => {
      const user = userEvent.setup()
      render(<HeaderActions session={mockSession} hasHousehold={false} />)

      const userMenuButton = screen.getByRole('button', { name: 'User menu' })
      await user.click(userMenuButton)

      expect(screen.queryByRole('menuitem', { name: 'Profile' })).not.toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
    })
  })

  describe('sign-out functionality', () => {
    it('calls authClient.signOut when sign-out is clicked', async () => {
      const user = userEvent.setup()
      const { authClient } = await import('@/lib/auth-client')
      vi.mocked(authClient.signOut).mockResolvedValue(undefined)

      render(<HeaderActions session={mockSession} hasHousehold={true} />)

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

      render(<HeaderActions session={mockSession} hasHousehold={true} />)

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

    it('handles sign-out exceptions gracefully', async () => {
      const user = userEvent.setup()
      const { authClient } = await import('@/lib/auth-client')

      vi.mocked(authClient.signOut).mockRejectedValue(new Error('Network error'))

      render(<HeaderActions session={mockSession} hasHousehold={true} />)

      // Open dropdown
      const userMenuButton = screen.getByRole('button', { name: 'User menu' })
      await user.click(userMenuButton)

      // Click sign out
      const signOutButton = screen.getByRole('menuitem', { name: 'Sign out' })
      await user.click(signOutButton)

      // Should not throw — component handles the error silently
      // User menu button should still be present (component didn't crash)
      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: 'User menu' })).toBeInTheDocument()
      })
    })
  })
})
