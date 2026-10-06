import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { MobileNav } from './mobile-nav'
import type { Session } from '@/lib/auth'

const adminLinks = [{ href: '/admin/signup-codes', label: 'Signup codes' }]

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: { signOut: vi.fn() },
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }),
}))

const session: Session = {
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

async function openSheet() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'User menu' }))
  return { user, nav: screen.getByRole('navigation', { name: 'Account menu' }) }
}

// HON-1092: the admin pages, for the session the server resolved as admin.
describe('MobileNav admin links', () => {
  it('shows Signup codes for the admin with a household, and closes the sheet on click', async () => {
    render(<MobileNav session={session} hasHousehold={true} adminLinks={adminLinks} />)
    const { user } = await openSheet()

    const link = screen.getByRole('link', { name: 'Signup codes' })
    expect(link).toHaveAttribute('href', '/admin/signup-codes')

    // jsdom cannot navigate; the row's own onClick still runs.
    link.addEventListener('click', (e) => e.preventDefault())
    await user.click(link)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows Signup codes for the admin without a household', async () => {
    render(<MobileNav session={session} hasHousehold={false} adminLinks={adminLinks} />)
    await openSheet()

    expect(screen.getByRole('link', { name: 'Signup codes' })).toBeInTheDocument()
  })

  it('renders no admin link and no /admin href for anyone else', async () => {
    render(<MobileNav session={session} hasHousehold={true} />)
    const { nav } = await openSheet()

    expect(screen.queryByRole('link', { name: 'Signup codes' })).not.toBeInTheDocument()
    expect(nav.querySelector('a[href^="/admin"]')).toBeNull()
  })
})
