import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toast } from 'sonner'
import { CreateInviteDialog } from './CreateInviteDialog'
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

const mockInviteResponse: Omit<Invite, 'isActive'> = {
  id: 'new-invite-1',
  code: 'NEWCODE',
  url: 'https://example.com/invite/NEWCODE',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  maxUses: 5,
  usesCount: 0,
  createdAt: new Date().toISOString(),
}

describe('CreateInviteDialog', () => {
  const mockOnInviteCreated = vi.fn()

  beforeEach(() => {
    mockFetch.mockReset()
    mockWriteText.mockReset()
    mockOnInviteCreated.mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('dialog trigger', () => {
    it('opens dialog when trigger button is clicked', async () => {
      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      expect(screen.getByText('Create invite link')).toBeInTheDocument()
      expect(
        screen.getByText('Create a shareable link to invite family members to your household.'),
      ).toBeInTheDocument()
    })
  })

  describe('form defaults', () => {
    it('has default expiry of 7 days', async () => {
      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      expect(screen.getByLabelText('Expires in (days)')).toHaveValue(7)
    })

    it('has default max uses of 5', async () => {
      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      expect(screen.getByLabelText('Maximum uses')).toHaveValue(5)
    })
  })

  describe('form inputs', () => {
    it('allows changing expiry days', async () => {
      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      const expiryInput = screen.getByLabelText('Expires in (days)')
      await userEvent.clear(expiryInput)
      await userEvent.type(expiryInput, '14')

      expect(expiryInput).toHaveValue(14)
    })

    it('allows changing max uses', async () => {
      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      const maxUsesInput = screen.getByLabelText('Maximum uses')
      await userEvent.clear(maxUsesInput)
      await userEvent.type(maxUsesInput, '10')

      expect(maxUsesInput).toHaveValue(10)
    })
  })

  describe('submit - success', () => {
    it('shows created invite view on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockInviteResponse),
      })

      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))
      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      await waitFor(() => {
        expect(screen.getByText('Invite created')).toBeInTheDocument()
      })

      expect(screen.getByDisplayValue('https://example.com/invite/NEWCODE')).toBeInTheDocument()
    })

    it('calls onInviteCreated callback', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockInviteResponse),
      })

      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))
      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      await waitFor(() => {
        expect(mockOnInviteCreated).toHaveBeenCalledWith({
          ...mockInviteResponse,
          isActive: true,
        })
      })
    })

    it('sends correct payload to API', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockInviteResponse),
      })

      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      // Change default values
      const expiryInput = screen.getByLabelText('Expires in (days)')
      await userEvent.clear(expiryInput)
      await userEvent.type(expiryInput, '14')

      const maxUsesInput = screen.getByLabelText('Maximum uses')
      await userEvent.clear(maxUsesInput)
      await userEvent.type(maxUsesInput, '10')

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/households/me/invites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expiresInDays: 14,
            maxUses: 10,
          }),
        })
      })
    })
  })

  describe('submit - error', () => {
    it('shows error message on API failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Failed to create invite' }),
      })

      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))
      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      await waitFor(() => {
        expect(screen.getByText('Failed to create invite')).toBeInTheDocument()
      })

      expect(mockOnInviteCreated).not.toHaveBeenCalled()
    })

    it('shows generic error when no error message in response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({}),
      })

      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))
      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      await waitFor(() => {
        expect(screen.getByText('Failed to create invite')).toBeInTheDocument()
      })
    })
  })

  describe('copy link', () => {
    it('copies link to clipboard and shows success toast', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockInviteResponse),
      })
      mockWriteText.mockResolvedValue(undefined)

      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))
      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      await waitFor(() => {
        expect(screen.getByText('Invite created')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByRole('button', { name: 'Copy' }))

      expect(mockWriteText).toHaveBeenCalledWith('https://example.com/invite/NEWCODE')
      expect(toast.success).toHaveBeenCalledWith('Link copied to clipboard')
    })

    it('shows Copied! feedback after copying', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockInviteResponse),
      })
      mockWriteText.mockResolvedValue(undefined)

      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))
      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      await waitFor(() => {
        expect(screen.getByText('Invite created')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByRole('button', { name: 'Copy' }))

      expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument()
    })

    it('shows error toast when copy fails', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockInviteResponse),
      })
      mockWriteText.mockRejectedValue(new Error('Clipboard error'))

      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))
      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      await waitFor(() => {
        expect(screen.getByText('Invite created')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByRole('button', { name: 'Copy' }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to copy link. Please copy manually.')
      })

      // Button should still say 'Copy' (not 'Copied!') after failure
      expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    })
  })

  describe('done button', () => {
    it('closes dialog when done is clicked', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockInviteResponse),
      })

      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))
      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      await waitFor(() => {
        expect(screen.getByText('Invite created')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByRole('button', { name: 'Done' }))

      await waitFor(() => {
        expect(screen.queryByText('Invite created')).not.toBeInTheDocument()
      })
    })

    it('resets form after closing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockInviteResponse),
      })

      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      // First creation
      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))
      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      await waitFor(() => {
        expect(screen.getByText('Invite created')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByRole('button', { name: 'Done' }))

      // Open dialog again
      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      // Should show the create form, not the success view
      expect(screen.getByText('Create invite link')).toBeInTheDocument()
      expect(screen.getByLabelText('Expires in (days)')).toHaveValue(7)
      expect(screen.getByLabelText('Maximum uses')).toHaveValue(5)
    })
  })

  describe('cancel button', () => {
    it('closes dialog when cancel is clicked', async () => {
      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      expect(screen.getByText('Create invite link')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      await waitFor(() => {
        expect(screen.queryByText('Create invite link')).not.toBeInTheDocument()
      })
    })

    it('resets form values after canceling', async () => {
      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      // Change values
      const expiryInput = screen.getByLabelText('Expires in (days)')
      await userEvent.clear(expiryInput)
      await userEvent.type(expiryInput, '14')

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      // Open again
      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      // Should have default values
      expect(screen.getByLabelText('Expires in (days)')).toHaveValue(7)
    })
  })

  describe('loading state', () => {
    it('disables inputs during submission', async () => {
      mockFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 500)),
      )

      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))
      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      expect(screen.getByLabelText('Expires in (days)')).toBeDisabled()
      expect(screen.getByLabelText('Maximum uses')).toBeDisabled()
    })

    it('shows Creating... text during submission', async () => {
      mockFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 500)),
      )

      render(<CreateInviteDialog onInviteCreated={mockOnInviteCreated} />)

      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))
      await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

      expect(screen.getByRole('button', { name: 'Creating...' })).toBeDisabled()
    })
  })
})
