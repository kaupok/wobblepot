import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toast } from 'sonner'
import { InviteCard } from './InviteCard'
import type { Invite } from '@/types/invite'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock clipboard
const mockWriteText = vi.fn()
Object.assign(navigator, {
  clipboard: {
    writeText: mockWriteText,
  },
})

const createInvite = (overrides: Partial<Invite> = {}): Invite => ({
  id: 'invite-1',
  code: 'ABC123',
  url: 'https://example.com/invite/ABC123',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
  maxUses: 5,
  usesCount: 2,
  isActive: true,
  createdAt: new Date().toISOString(),
  ...overrides,
})

describe('InviteCard', () => {
  const mockOnRevoke = vi.fn()

  beforeEach(() => {
    mockFetch.mockReset()
    mockWriteText.mockReset()
    mockOnRevoke.mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('active invite display', () => {
    it('shows Active badge for active invite', () => {
      render(<InviteCard invite={createInvite()} onRevoke={mockOnRevoke} />)

      expect(screen.getByText('Active')).toBeInTheDocument()
    })

    it('shows copy button for active invite', () => {
      render(<InviteCard invite={createInvite()} onRevoke={mockOnRevoke} />)

      expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    })

    it('shows revoke button for active invite', () => {
      render(<InviteCard invite={createInvite()} onRevoke={mockOnRevoke} />)

      expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument()
    })

    it('displays the invite URL', () => {
      render(<InviteCard invite={createInvite()} onRevoke={mockOnRevoke} />)

      expect(screen.getByDisplayValue('https://example.com/invite/ABC123')).toBeInTheDocument()
    })
  })

  describe('inactive invite display', () => {
    it('shows Expired badge for inactive invite', () => {
      render(<InviteCard invite={createInvite({ isActive: false })} onRevoke={mockOnRevoke} />)

      expect(screen.getByText('Expired')).toBeInTheDocument()
    })

    it('does not show copy button for expired invite', () => {
      render(<InviteCard invite={createInvite({ isActive: false })} onRevoke={mockOnRevoke} />)

      expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
    })

    it('does not show revoke button for expired invite', () => {
      render(<InviteCard invite={createInvite({ isActive: false })} onRevoke={mockOnRevoke} />)

      expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()
    })

    it('applies muted styling to expired invite', () => {
      const { container } = render(
        <InviteCard invite={createInvite({ isActive: false })} onRevoke={mockOnRevoke} />,
      )

      // Expired invites have reduced opacity on the root card
      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
      const cardRoot = container.querySelector('div.rounded-lg')
      expect(cardRoot).toHaveClass('opacity-75')
    })
  })

  describe('usage text', () => {
    it('shows "X/Y uses" for limited invites', () => {
      render(
        <InviteCard invite={createInvite({ usesCount: 2, maxUses: 5 })} onRevoke={mockOnRevoke} />,
      )

      expect(screen.getByText('2/5 uses')).toBeInTheDocument()
    })

    it('shows "X uses" for unlimited invites', () => {
      render(
        <InviteCard
          invite={createInvite({ usesCount: 3, maxUses: null })}
          onRevoke={mockOnRevoke}
        />,
      )

      expect(screen.getByText('3 uses')).toBeInTheDocument()
    })
  })

  describe('expiry text', () => {
    it('shows "Expires today" for invite expiring today', () => {
      // For "today", the expire time needs to be in the past but within 24h
      // so that Math.ceil(diffMs / dayMs) = 0
      const earlierToday = new Date()
      earlierToday.setHours(earlierToday.getHours() - 1) // 1 hour ago

      render(
        <InviteCard
          invite={createInvite({ expiresAt: earlierToday.toISOString() })}
          onRevoke={mockOnRevoke}
        />,
      )

      expect(screen.getByText('Expires today')).toBeInTheDocument()
    })

    it('shows "Expires tomorrow" for invite expiring tomorrow', () => {
      // 12 hours from now gives diffDays = Math.ceil(0.5) = 1 -> "tomorrow"
      const tomorrow = new Date(Date.now() + 12 * 60 * 60 * 1000)

      render(
        <InviteCard
          invite={createInvite({ expiresAt: tomorrow.toISOString() })}
          onRevoke={mockOnRevoke}
        />,
      )

      expect(screen.getByText('Expires tomorrow')).toBeInTheDocument()
    })

    it('shows "Expires in X days" for future expiry', () => {
      const future = new Date()
      future.setDate(future.getDate() + 5)

      render(
        <InviteCard
          invite={createInvite({ expiresAt: future.toISOString() })}
          onRevoke={mockOnRevoke}
        />,
      )

      expect(screen.getByText('Expires in 5 days')).toBeInTheDocument()
    })

    it('does not show expiry text for inactive invites', () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)

      render(
        <InviteCard
          invite={createInvite({ expiresAt: yesterday.toISOString(), isActive: false })}
          onRevoke={mockOnRevoke}
        />,
      )

      // Expiry text is hidden for inactive invites since the badge already shows status
      // The badge shows "Expired" but no additional expiry time text like "Expired yesterday"
      expect(screen.queryByText(/Expired yesterday/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Expired \d+ days ago/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Expires/)).not.toBeInTheDocument()
    })
  })

  describe('copy action', () => {
    it('copies URL to clipboard and shows success toast', async () => {
      mockWriteText.mockResolvedValue(undefined)

      render(<InviteCard invite={createInvite()} onRevoke={mockOnRevoke} />)

      await userEvent.click(screen.getByRole('button', { name: 'Copy' }))

      expect(mockWriteText).toHaveBeenCalledWith('https://example.com/invite/ABC123')
      expect(toast.success).toHaveBeenCalledWith('Link copied to clipboard')
    })

    it('shows error toast when copy fails', async () => {
      mockWriteText.mockRejectedValue(new Error('Clipboard error'))

      render(<InviteCard invite={createInvite()} onRevoke={mockOnRevoke} />)

      await userEvent.click(screen.getByRole('button', { name: 'Copy' }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to copy link. Please copy manually.')
      })
    })
  })

  describe('revoke flow', () => {
    it('opens confirm dialog when revoke is clicked', async () => {
      render(<InviteCard invite={createInvite()} onRevoke={mockOnRevoke} />)

      await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))

      expect(screen.getByText('Revoke invite')).toBeInTheDocument()
      expect(
        screen.getByText(
          'Are you sure you want to revoke this invite? This action cannot be undone.',
        ),
      ).toBeInTheDocument()
    })

    it('calls API and onRevoke callback on confirm', async () => {
      mockFetch.mockResolvedValue({ ok: true })

      render(<InviteCard invite={createInvite()} onRevoke={mockOnRevoke} />)

      await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))
      await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/households/me/invites/invite-1', {
          method: 'DELETE',
        })
      })

      await waitFor(() => {
        expect(mockOnRevoke).toHaveBeenCalledWith('invite-1')
        expect(toast.success).toHaveBeenCalledWith('Invite revoked')
      })
    })

    it('shows error toast on API failure', async () => {
      mockFetch.mockResolvedValue({ ok: false })

      render(<InviteCard invite={createInvite()} onRevoke={mockOnRevoke} />)

      await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))
      await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to revoke invite. Please try again.')
      })

      expect(mockOnRevoke).not.toHaveBeenCalled()
    })

    it('closes dialog when cancel is clicked', async () => {
      render(<InviteCard invite={createInvite()} onRevoke={mockOnRevoke} />)

      await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))
      expect(screen.getByText('Revoke invite')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      await waitFor(() => {
        expect(screen.queryByText('Revoke invite')).not.toBeInTheDocument()
      })
    })
  })
})
