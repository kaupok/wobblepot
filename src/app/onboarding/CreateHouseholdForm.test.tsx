import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CreateHouseholdForm } from './CreateHouseholdForm'
import { createQueryWrapper } from '@/test/query-wrapper'

// Mock next/navigation
const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}))

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

function renderForm(userName = 'John') {
  const { wrapper } = createQueryWrapper()
  return render(<CreateHouseholdForm userName={userName} />, { wrapper })
}

describe('CreateHouseholdForm', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockPush.mockReset()
    mockRefresh.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Step 1: Household name', () => {
    it('renders first step with heading and progress indicator', () => {
      renderForm()

      expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
      expect(screen.getByText('Create your household')).toBeInTheDocument()
      expect(screen.getByText('Give your household a name to get started')).toBeInTheDocument()
    })

    it('renders name input with default value based on userName', () => {
      renderForm()

      const nameInput = screen.getByLabelText('Household name')
      expect(nameInput).toHaveValue("John's Household")
    })

    it('renders Continue button on first step', () => {
      renderForm()

      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    })

    it('allows editing the household name', async () => {
      renderForm()

      const nameInput = screen.getByLabelText('Household name')
      await userEvent.clear(nameInput)
      await userEvent.type(nameInput, 'The Smith Family')

      expect(nameInput).toHaveValue('The Smith Family')
    })

    it('shows error when trying to continue with empty name', async () => {
      renderForm()

      const nameInput = screen.getByLabelText('Household name')
      await userEvent.clear(nameInput)

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByRole('alert')).toHaveTextContent('Household name is required')
      expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    })
  })

  describe('Step 2: Household members', () => {
    it('navigates to step 2 when continuing from step 1', async () => {
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByText('Step 2 of 2')).toBeInTheDocument()
      expect(screen.getByText('Household members')).toBeInTheDocument()
      expect(screen.getByText('Tell us about your household')).toBeInTheDocument()
    })

    it('shows Create household button on final step', async () => {
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByRole('button', { name: 'Create household' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
    })

    it('shows Back button on step 2', async () => {
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    })

    it('navigates back to step 1', async () => {
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Back' }))

      expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    })

    it('shows household size input with default value 1', async () => {
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      const sizeInput = screen.getByLabelText('How many people in your household?')
      expect(sizeInput).toHaveValue(1)
    })

    it('shows first member row pre-filled with user name and disabled', async () => {
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      const firstMemberInput = screen.getByLabelText('Member 1 name')
      expect(firstMemberInput).toHaveValue('John')
      expect(firstMemberInput).toBeDisabled()
    })

    it('expands member rows when increasing household size', async () => {
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      // Increase to 3
      await userEvent.click(screen.getByRole('button', { name: 'Increase household size' }))
      await userEvent.click(screen.getByRole('button', { name: 'Increase household size' }))

      expect(screen.getByLabelText('Member 1 name')).toBeInTheDocument()
      expect(screen.getByLabelText('Member 2 name')).toBeInTheDocument()
      expect(screen.getByLabelText('Member 3 name')).toBeInTheDocument()
    })

    it('collapses member rows when decreasing household size', async () => {
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      // Increase to 3, then decrease to 2
      await userEvent.click(screen.getByRole('button', { name: 'Increase household size' }))
      await userEvent.click(screen.getByRole('button', { name: 'Increase household size' }))
      await userEvent.click(screen.getByRole('button', { name: 'Decrease household size' }))

      expect(screen.getByLabelText('Member 1 name')).toBeInTheDocument()
      expect(screen.getByLabelText('Member 2 name')).toBeInTheDocument()
      expect(screen.queryByLabelText('Member 3 name')).not.toBeInTheDocument()
    })

    it('does not allow decreasing below 1', async () => {
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByRole('button', { name: 'Decrease household size' })).toBeDisabled()
    })

    it('allows toggling Adult/Child for additional members', async () => {
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      // Add a second member
      await userEvent.click(screen.getByRole('button', { name: 'Increase household size' }))

      // Find the Child buttons (there are 2: one for member 1 disabled, one for member 2)
      const childButtons = screen.getAllByRole('button', { name: 'Child' })
      // Click the second Child button (for member 2)
      const member2ChildBtn = childButtons[1]
      if (!member2ChildBtn) throw new Error('Member 2 Child button not found')
      await userEvent.click(member2ChildBtn)

      // The Child button for member 2 should now be the "default" variant
      expect(member2ChildBtn).toHaveClass('text-xs')
    })

    it('allows entering names for additional members', async () => {
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      await userEvent.click(screen.getByRole('button', { name: 'Increase household size' }))

      const member2Input = screen.getByLabelText('Member 2 name')
      await userEvent.type(member2Input, 'Emma')

      expect(member2Input).toHaveValue('Emma')
    })
  })

  describe('Form submission', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    async function navigateToFinalStep() {
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      // Wait for transition guard to clear (100ms timeout in handleNext)
      await vi.advanceTimersByTimeAsync(150)
    }

    it('submits form with name and members', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'household-123',
            name: 'My Household',
          }),
      })

      renderForm()

      // Step 1: Edit name
      const nameInput = screen.getByLabelText('Household name')
      await userEvent.clear(nameInput)
      await userEvent.type(nameInput, 'My Household')

      // Step 2: Add a member named Emma as child
      await navigateToFinalStep()

      await userEvent.click(screen.getByRole('button', { name: 'Increase household size' }))
      const member2Input = screen.getByLabelText('Member 2 name')
      await userEvent.type(member2Input, 'Emma')

      // Toggle member 2 to Child
      const childButtons = screen.getAllByRole('button', { name: 'Child' })
      const member2ChildBtn = childButtons[1]
      if (!member2ChildBtn) throw new Error('Member 2 Child button not found')
      await userEvent.click(member2ChildBtn)

      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/households', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'My Household',
            members: [{ name: 'Emma', portionType: 'child' }],
          }),
        })
      })
    })

    it('submits form with defaults when no changes made', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'household-123',
            name: "John's Household",
          }),
      })

      renderForm()

      await navigateToFinalStep()
      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/households', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: "John's Household",
            members: [],
          }),
        })
      })
    })

    it('generates default names for unnamed members', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'household-123',
            name: "John's Household",
          }),
      })

      renderForm()

      await navigateToFinalStep()

      // Add 2 more members (total 3), leave names empty
      await userEvent.click(screen.getByRole('button', { name: 'Increase household size' }))
      await userEvent.click(screen.getByRole('button', { name: 'Increase household size' }))

      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/households', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: "John's Household",
            members: [
              { name: 'Adult 2', portionType: 'adult' },
              { name: 'Adult 3', portionType: 'adult' },
            ],
          }),
        })
      })
    })

    it('generates correct default names for mixed adult/child members', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'household-123',
            name: "John's Household",
          }),
      })

      renderForm()

      await navigateToFinalStep()

      // Add 2 members
      await userEvent.click(screen.getByRole('button', { name: 'Increase household size' }))
      await userEvent.click(screen.getByRole('button', { name: 'Increase household size' }))

      // Toggle member 2 to Child
      const childButtons = screen.getAllByRole('button', { name: 'Child' })
      const member2ChildBtn = childButtons[1]
      if (!member2ChildBtn) throw new Error('Member 2 Child button not found')
      await userEvent.click(member2ChildBtn)

      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/households', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: "John's Household",
            members: [
              { name: 'Child 1', portionType: 'child' },
              { name: 'Adult 2', portionType: 'adult' },
            ],
          }),
        })
      })
    })

    it('redirects to meal-plan on successful creation', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'household-123',
            name: "John's Household",
          }),
      })

      renderForm()

      await navigateToFinalStep()
      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
        expect(mockRefresh).toHaveBeenCalled()
      })
    })

    it('shows loading state during submission', async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: () => Promise.resolve({ id: 'household-123' }),
                }),
              100,
            ),
          ),
      )

      renderForm()

      await navigateToFinalStep()
      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      expect(screen.getByRole('button', { name: 'Creating...' })).toBeDisabled()
    })

    it('shows error message on API failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: 'Validation failed',
            message: 'Invalid data',
          }),
      })

      renderForm()

      await navigateToFinalStep()
      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Invalid data')
      })
    })

    it('redirects to meal-plan if user already has household', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: 'already_in_household',
            message: 'You are already a member of a household.',
          }),
      })

      renderForm()

      await navigateToFinalStep()
      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
        expect(mockRefresh).toHaveBeenCalled()
      })
    })

    it('handles network failure gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      renderForm()

      await navigateToFinalStep()
      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Unable to connect. Please check your internet connection.',
        )
      })
    })
  })
})
