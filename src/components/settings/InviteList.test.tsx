import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { InviteList } from './InviteList'
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

// Mock clipboard for InviteCard
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
})

const createInvite = (overrides: Partial<Invite> = {}): Invite => ({
  id: 'invite-1',
  code: 'ABC123',
  url: 'https://example.com/invite/ABC123',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  maxUses: 5,
  usesCount: 2,
  isActive: true,
  createdAt: new Date().toISOString(),
  ...overrides,
})

describe('InviteList', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('non-owner view', () => {
    it('shows owner-only message for non-owners', () => {
      render(<InviteList isOwner={false} />)

      expect(screen.getByText('Only the household owner can manage invites.')).toBeInTheDocument()
    })

    it('does not fetch invites for non-owners', () => {
      render(<InviteList isOwner={false} />)

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('does not show create invite button for non-owners', () => {
      render(<InviteList isOwner={false} />)

      expect(screen.queryByRole('button', { name: 'Create invite' })).not.toBeInTheDocument()
    })
  })

  describe('owner view - loading', () => {
    it('shows loading skeletons while fetching', () => {
      mockFetch.mockImplementation(() => new Promise(() => {})) // Never resolves

      render(<InviteList isOwner={true} />)

      // Should render skeleton placeholders instead of text
      const skeletons = screen
        .getAllByRole('generic')
        .filter((el) => el.dataset.slot === 'skeleton')
      expect(skeletons.length).toBeGreaterThan(0)
    })
  })

  describe('owner view - empty', () => {
    it('shows empty state when no invites exist', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ invites: [] }),
      })

      render(<InviteList isOwner={true} />)

      await waitFor(() => {
        expect(
          screen.getByText('No invites yet. Create an invite link to share with family members.'),
        ).toBeInTheDocument()
      })
    })
  })

  describe('owner view - error', () => {
    it('shows error message on fetch failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      })

      render(<InviteList isOwner={true} />)

      await waitFor(() => {
        expect(screen.getByText('Failed to fetch invites')).toBeInTheDocument()
      })
    })

    it('handles 403 gracefully for non-owner', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
      })

      render(<InviteList isOwner={true} />)

      await waitFor(() => {
        expect(screen.queryByText('Failed to fetch invites')).not.toBeInTheDocument()
      })
    })
  })

  describe('owner view - with invites', () => {
    it('renders active invites', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            invites: [
              createInvite({
                id: 'invite-1',
                code: 'ABC123',
                url: 'https://example.com/invite/ABC123',
              }),
              createInvite({
                id: 'invite-2',
                code: 'DEF456',
                url: 'https://example.com/invite/DEF456',
              }),
            ],
          }),
      })

      render(<InviteList isOwner={true} />)

      await waitFor(() => {
        expect(screen.getByText('Active invites')).toBeInTheDocument()
      })

      // Check both invites are rendered
      expect(screen.getByDisplayValue('https://example.com/invite/ABC123')).toBeInTheDocument()
      expect(screen.getByDisplayValue('https://example.com/invite/DEF456')).toBeInTheDocument()
    })

    it('shows create invite button', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ invites: [] }),
      })

      render(<InviteList isOwner={true} />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Create invite' })).toBeInTheDocument()
      })
    })
  })

  describe('expired invites collapsible', () => {
    it('shows expired invites section when there are expired invites', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            invites: [createInvite({ id: 'expired-1', isActive: false })],
          }),
      })

      render(<InviteList isOwner={true} />)

      await waitFor(() => {
        expect(screen.getByText(/Expired invites/)).toBeInTheDocument()
      })
    })

    it('hides expired invite content by default', async () => {
      const pastDate = new Date()
      pastDate.setDate(pastDate.getDate() - 1)

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            invites: [
              createInvite({
                id: 'expired-1',
                code: 'EXPIRED1',
                url: 'https://example.com/invite/EXPIRED1',
                isActive: false,
                expiresAt: pastDate.toISOString(),
              }),
            ],
          }),
      })

      render(<InviteList isOwner={true} />)

      await waitFor(() => {
        expect(screen.getByText(/Expired invites/)).toBeInTheDocument()
      })

      // The expired invite URL should not be visible when collapsed
      expect(
        screen.queryByDisplayValue('https://example.com/invite/EXPIRED1'),
      ).not.toBeInTheDocument()
    })

    it('expands expired invites on click', async () => {
      const pastDate = new Date()
      pastDate.setDate(pastDate.getDate() - 1)

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            invites: [
              createInvite({
                id: 'expired-1',
                code: 'EXPIRED1',
                url: 'https://example.com/invite/EXPIRED1',
                isActive: false,
                expiresAt: pastDate.toISOString(),
              }),
            ],
          }),
      })

      render(<InviteList isOwner={true} />)

      await waitFor(() => {
        expect(screen.getByText(/Expired invites/)).toBeInTheDocument()
      })

      await userEvent.click(screen.getByRole('button', { name: /Expired invites/ }))

      await waitFor(() => {
        expect(screen.getByDisplayValue('https://example.com/invite/EXPIRED1')).toBeInTheDocument()
      })
    })
  })

  describe('invite management', () => {
    it('removes invite from list when revoked', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              invites: [createInvite({ id: 'invite-1', code: 'ABC123' })],
            }),
        })
        .mockResolvedValueOnce({ ok: true }) // DELETE call

      render(<InviteList isOwner={true} />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('https://example.com/invite/ABC123')).toBeInTheDocument()
      })

      // Click revoke button
      await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))
      // Confirm in dialog
      await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))

      await waitFor(() => {
        expect(
          screen.queryByDisplayValue('https://example.com/invite/ABC123'),
        ).not.toBeInTheDocument()
      })
    })
  })
})
