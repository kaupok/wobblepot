import { act, render, screen, waitFor, within } from '@testing-library/react'
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
      expect(
        screen.getByRole('heading', { level: 1, name: 'Create your household' }),
      ).toBeInTheDocument()
      expect(screen.getByText('Give your household a name to get started')).toBeInTheDocument()
    })

    it('renders name input with default value based on userName', () => {
      renderForm()

      const nameInput = screen.getByLabelText('Household name')
      expect(nameInput).toHaveValue("John's Household")
    })

    // The input's id is `name`, so without this a browser offers the person's own name.
    it('turns off autofill on the household name input', () => {
      renderForm()

      const nameInput = screen.getByLabelText('Household name')
      expect(nameInput).toHaveAttribute('name', 'householdName')
      expect(nameInput).toHaveAttribute('autocomplete', 'off')
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

  describe('Focus management', () => {
    it('focuses the household name input on first render', () => {
      renderForm()

      expect(screen.getByLabelText('Household name')).toHaveFocus()
    })

    it('focuses the step 2 title, described by the step number, after Continue', async () => {
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      const title = screen.getByRole('heading', { level: 1, name: 'Household members' })
      expect(title).toHaveFocus()
      expect(title).toHaveAccessibleDescription('Step 2 of 2')
    })

    it('focuses the step 1 title, described by the step number, after Back', async () => {
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Back' }))

      const title = screen.getByRole('heading', { level: 1, name: 'Create your household' })
      expect(title).toHaveFocus()
      expect(title).toHaveAccessibleDescription('Step 1 of 2')
    })
  })

  describe('Step 2: Household members', () => {
    it('navigates to step 2 when continuing from step 1', async () => {
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByText('Step 2 of 2')).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { level: 1, name: 'Household members' }),
      ).toBeInTheDocument()
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
      expect(sizeInput).toHaveValue('1')
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

      // Each member row is its own radiogroup, named by its position (HON-828)
      const member2Type = screen.getByRole('radiogroup', { name: 'Member 2 type' })
      const adult = within(member2Type).getByRole('radio', { name: 'Adult' })
      const child = within(member2Type).getByRole('radio', { name: 'Child' })
      expect(adult).toHaveAttribute('aria-checked', 'true')
      expect(child).toHaveAttribute('aria-checked', 'false')

      await userEvent.click(child)

      expect(child).toHaveAttribute('aria-checked', 'true')
      expect(adult).toHaveAttribute('aria-checked', 'false')
    })

    it('names every member type group distinctly and keeps the first one disabled', async () => {
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      for (let i = 0; i < 3; i++) {
        await userEvent.click(screen.getByRole('button', { name: 'Increase household size' }))
      }

      const groups = screen.getAllByRole('radiogroup')
      expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
        'Member 1 type',
        'Member 2 type',
        'Member 3 type',
        'Member 4 type',
      ])
      const member1Radios = within(screen.getByRole('radiogroup', { name: 'Member 1 type' }))
      expect(member1Radios.getByRole('radio', { name: 'Adult' })).toBeDisabled()
      expect(member1Radios.getByRole('radio', { name: 'Child' })).toBeDisabled()
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
      await userEvent.click(
        within(screen.getByRole('radiogroup', { name: 'Member 2 type' })).getByRole('radio', {
          name: 'Child',
        }),
      )

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
      await userEvent.click(
        within(screen.getByRole('radiogroup', { name: 'Member 2 type' })).getByRole('radio', {
          name: 'Child',
        }),
      )

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

      expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled()
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

    // Chromium blurs a focused button when it becomes disabled, so while the
    // request is pending focus is on the body. jsdom keeps it on the button
    // (and ignores `blur()` on a disabled element), so move it to the body the
    // way the browser does before the request settles.
    function dropFocusToBody() {
      act(() => {
        document.body.tabIndex = -1
        document.body.focus()
        document.body.removeAttribute('tabindex')
      })
      expect(document.body).toHaveFocus()
    }

    it('returns focus to the submit button after a failed create', async () => {
      let rejectRequest!: (reason: Error) => void
      mockFetch.mockReturnValue(
        new Promise((_, reject) => {
          rejectRequest = reject
        }),
      )

      renderForm()

      await navigateToFinalStep()
      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))
      expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled()
      dropFocusToBody()

      await act(async () => rejectRequest(new Error('Network error')))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Create household' })).toHaveFocus()
      })
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Unable to connect. Please check your internet connection.',
      )
    })

    it('returns focus to the submit button after the route answers with an error', async () => {
      let resolveRequest!: (value: unknown) => void
      mockFetch.mockReturnValue(
        new Promise((resolve) => {
          resolveRequest = resolve
        }),
      )

      renderForm()

      await navigateToFinalStep()
      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))
      dropFocusToBody()

      await act(async () =>
        resolveRequest({
          ok: false,
          json: () => Promise.resolve({ error: 'Validation failed' }),
        }),
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Create household' })).toHaveFocus()
      })
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to create household')
    })

    it('shows the translated fallback when the failure carries no message', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        // Deliberately distinct from the translated fallback, so this test can
        // tell the two apart — a value that merely matched it would pass
        // whether or not `data.error` still leaks through.
        json: () => Promise.resolve({ error: 'Validation failed' }),
      })

      renderForm()

      await navigateToFinalStep()
      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        // The raw `error` field is a machine code or untranslated English, so
        // it must not reach the user — the translated string does.
        expect(screen.getByRole('alert')).toHaveTextContent('Failed to create household')
      })
      expect(mockFetch).toHaveBeenCalled()
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
