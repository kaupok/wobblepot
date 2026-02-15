import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CreateHouseholdForm } from './CreateHouseholdForm'

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

// Mock crypto.randomUUID for consistent test results
vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid',
})

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
      render(<CreateHouseholdForm userName="John" />)

      expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
      expect(screen.getByText('Create your household')).toBeInTheDocument()
      expect(screen.getByText('Give your household a name to get started')).toBeInTheDocument()
    })

    it('renders name input with default value based on userName', () => {
      render(<CreateHouseholdForm userName="John" />)

      const nameInput = screen.getByLabelText('Household name')
      expect(nameInput).toHaveValue("John's Household")
    })

    it('renders Continue button on first step', () => {
      render(<CreateHouseholdForm userName="John" />)

      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    })

    it('allows editing the household name', async () => {
      render(<CreateHouseholdForm userName="John" />)

      const nameInput = screen.getByLabelText('Household name')
      await userEvent.clear(nameInput)
      await userEvent.type(nameInput, 'The Smith Family')

      expect(nameInput).toHaveValue('The Smith Family')
    })

    it('shows error when trying to continue with empty name', async () => {
      render(<CreateHouseholdForm userName="John" />)

      const nameInput = screen.getByLabelText('Household name')
      await userEvent.clear(nameInput)

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByRole('alert')).toHaveTextContent('Household name is required')
      expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
    })
  })

  describe('Step 2: Meal types', () => {
    it('navigates to step 2 when continuing from step 1', async () => {
      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByText('Step 2 of 4')).toBeInTheDocument()
      expect(screen.getByText('Meals to plan')).toBeInTheDocument()
      expect(screen.getByText('Which meals do you want to plan?')).toBeInTheDocument()
    })

    it('shows only dinner checked by default', async () => {
      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      // There are 6 checkboxes (3 weekday + 3 weekend)
      const checkboxes = screen.getAllByRole('checkbox')
      expect(checkboxes).toHaveLength(6)

      // Only dinner should be checked for both weekday and weekend
      const dinnerCheckboxes = screen.getAllByRole('checkbox', { name: 'Dinner' })
      dinnerCheckboxes.forEach((checkbox) => {
        expect(checkbox).toBeChecked()
      })

      const breakfastCheckboxes = screen.getAllByRole('checkbox', { name: 'Breakfast' })
      breakfastCheckboxes.forEach((checkbox) => {
        expect(checkbox).not.toBeChecked()
      })

      const lunchCheckboxes = screen.getAllByRole('checkbox', { name: 'Lunch' })
      lunchCheckboxes.forEach((checkbox) => {
        expect(checkbox).not.toBeChecked()
      })
    })

    it('allows toggling meal types', async () => {
      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      // Uncheck dinner (checked by default)
      const dinnerCheckboxes = screen.getAllByRole('checkbox', { name: 'Dinner' })
      const weekdayDinner = dinnerCheckboxes[0]
      if (!weekdayDinner) throw new Error('Weekday dinner checkbox not found')
      await userEvent.click(weekdayDinner)
      expect(weekdayDinner).not.toBeChecked()

      // Check breakfast (unchecked by default)
      const breakfastCheckboxes = screen.getAllByRole('checkbox', { name: 'Breakfast' })
      const weekdayBreakfast = breakfastCheckboxes[0]
      if (!weekdayBreakfast) throw new Error('Weekday breakfast checkbox not found')
      await userEvent.click(weekdayBreakfast)
      expect(weekdayBreakfast).toBeChecked()
    })

    it('shows Back button on step 2', async () => {
      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    })

    it('navigates back to step 1', async () => {
      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Back' }))

      expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
    })
  })

  describe('Step 3: Dietary preferences', () => {
    it('navigates to step 3', async () => {
      render(<CreateHouseholdForm userName="John" />)

      // Step 1 -> 2
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      // Step 2 -> 3
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByText('Step 3 of 4')).toBeInTheDocument()
      expect(screen.getByText('Dietary preferences')).toBeInTheDocument()
      expect(screen.getByText('Help us find the right meals for you')).toBeInTheDocument()
    })

    it('shows dietary type radio buttons with no preference selected', async () => {
      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByRole('radio', { name: 'No preference' })).toBeChecked()
      expect(screen.getByRole('radio', { name: 'Omnivore' })).not.toBeChecked()
      expect(screen.getByRole('radio', { name: 'Vegetarian' })).not.toBeChecked()
      expect(screen.getByRole('radio', { name: 'Vegan' })).not.toBeChecked()
      expect(screen.getByRole('radio', { name: 'Pescatarian' })).not.toBeChecked()
    })

    it('allows selecting dietary type', async () => {
      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      await userEvent.click(screen.getByRole('radio', { name: 'Vegetarian' }))

      expect(screen.getByRole('radio', { name: 'Vegetarian' })).toBeChecked()
    })

    it('shows allergen checkboxes all unchecked by default', async () => {
      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByRole('checkbox', { name: 'Gluten' })).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Dairy' })).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Tree nuts' })).not.toBeChecked()
    })

    it('allows selecting allergens', async () => {
      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      await userEvent.click(screen.getByRole('checkbox', { name: 'Gluten' }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'Dairy' }))

      expect(screen.getByRole('checkbox', { name: 'Gluten' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Dairy' })).toBeChecked()
    })
  })

  describe('Step 4: Household members', () => {
    it('navigates to step 4', async () => {
      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByText('Step 4 of 4')).toBeInTheDocument()
      expect(screen.getByText('Household members')).toBeInTheDocument()
      expect(screen.getByText('Add other family members (optional)')).toBeInTheDocument()
    })

    it('shows Create household button on final step', async () => {
      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByRole('button', { name: 'Create household' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
    })

    it('allows adding a member', async () => {
      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      const nameInput = screen.getByPlaceholderText('Enter name')
      await userEvent.type(nameInput, 'Emma')
      await userEvent.click(screen.getByRole('button', { name: 'Add member' }))

      expect(screen.getByText('Emma')).toBeInTheDocument()
      expect(nameInput).toHaveValue('')
    })

    it('allows adding member by pressing Enter', async () => {
      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      const nameInput = screen.getByPlaceholderText('Enter name')
      await userEvent.type(nameInput, 'Emma{enter}')

      expect(screen.getByText('Emma')).toBeInTheDocument()
    })

    it('allows removing a member', async () => {
      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      const nameInput = screen.getByPlaceholderText('Enter name')
      await userEvent.type(nameInput, 'Emma{enter}')

      const membersList = screen.getByRole('list')
      const removeButton = within(membersList).getByRole('button', { name: 'Remove Emma' })
      await userEvent.click(removeButton)

      expect(screen.queryByText('Emma')).not.toBeInTheDocument()
    })

    it('does not add empty member names', async () => {
      render(<CreateHouseholdForm userName="John" />)

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      const nameInput = screen.getByPlaceholderText('Enter name')
      await userEvent.type(nameInput, '   ')
      await userEvent.click(screen.getByRole('button', { name: 'Add member' }))

      expect(screen.queryByRole('list')).not.toBeInTheDocument()
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
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      // Wait for transition guard to clear (100ms timeout in handleNext)
      await vi.advanceTimersByTimeAsync(150)
    }

    it('submits form with all collected data', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'household-123',
            name: 'My Household',
          }),
      })

      render(<CreateHouseholdForm userName="John" />)

      // Step 1: Edit name
      const nameInput = screen.getByLabelText('Household name')
      await userEvent.clear(nameInput)
      await userEvent.type(nameInput, 'My Household')

      // Step 2: Check breakfast on weekdays (only dinner is checked by default)
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      const breakfastCheckboxes = screen.getAllByRole('checkbox', { name: 'Breakfast' })
      const weekdayBreakfast = breakfastCheckboxes[0]
      if (!weekdayBreakfast) throw new Error('Weekday breakfast checkbox not found')
      await userEvent.click(weekdayBreakfast)

      // Step 3: Select vegetarian and gluten allergen
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await userEvent.click(screen.getByRole('radio', { name: 'Vegetarian' }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'Gluten' }))

      // Step 4: Add a member and submit
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      const memberInput = screen.getByPlaceholderText('Enter name')
      await userEvent.type(memberInput, 'Emma{enter}')

      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/households', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'My Household',
            preferences: {
              dietaryType: 'vegetarian',
              allergensToAvoid: ['gluten'],
              weekdayMealTypes: ['dinner', 'breakfast'],
              weekendMealTypes: ['dinner'],
            },
            members: [{ name: 'Emma' }],
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

      render(<CreateHouseholdForm userName="John" />)

      await navigateToFinalStep()
      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/households', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: "John's Household",
            preferences: {
              dietaryType: null,
              allergensToAvoid: [],
              weekdayMealTypes: ['dinner'],
              weekendMealTypes: ['dinner'],
            },
            members: [],
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

      render(<CreateHouseholdForm userName="John" />)

      await navigateToFinalStep()
      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/meal-plan')
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

      render(<CreateHouseholdForm userName="John" />)

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

      render(<CreateHouseholdForm userName="John" />)

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

      render(<CreateHouseholdForm userName="John" />)

      await navigateToFinalStep()
      await userEvent.click(screen.getByRole('button', { name: 'Create household' }))

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/meal-plan')
        expect(mockRefresh).toHaveBeenCalled()
      })
    })

    it('handles network failure gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      render(<CreateHouseholdForm userName="John" />)

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
