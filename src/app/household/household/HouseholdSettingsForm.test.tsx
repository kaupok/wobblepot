import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toast } from 'sonner'
import { HouseholdSettingsForm } from './HouseholdSettingsForm'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

type DietaryType = 'omnivore' | 'vegetarian' | 'vegan' | 'pescatarian'
type Allergen =
  | 'gluten'
  | 'dairy'
  | 'eggs'
  | 'nuts'
  | 'peanuts'
  | 'soy'
  | 'fish'
  | 'shellfish'
  | 'sesame'
type MealType = 'breakfast' | 'lunch' | 'dinner'

const defaultHousehold = {
  id: 'household-1',
  name: 'Test Household',
  timezone: 'Europe/Tallinn',
}

const defaultPreferences: {
  dietaryType: DietaryType | null
  allergensToAvoid: Allergen[]
  restrictions: string[]
  excludedIngredients: string[]
  weekdayMealTypes: MealType[]
  weekendMealTypes: MealType[]
} = {
  dietaryType: null,
  allergensToAvoid: [],
  restrictions: [],
  excludedIngredients: [],
  weekdayMealTypes: ['dinner'],
  weekendMealTypes: ['dinner'],
}

describe('HouseholdSettingsForm', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders all form sections', () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={true}
        />,
      )

      expect(screen.getByText('Basic information')).toBeInTheDocument()
      expect(screen.getByText('Dietary preferences')).toBeInTheDocument()
      expect(screen.getByText('Excluded ingredients')).toBeInTheDocument()
      expect(screen.getByText('Meal scheduling')).toBeInTheDocument()
    })

    it('renders household name input with initial value', () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={true}
        />,
      )

      const nameInput = screen.getByLabelText('Household name')
      expect(nameInput).toHaveValue('Test Household')
    })

    it('renders dietary type radio buttons', () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={true}
        />,
      )

      expect(screen.getByLabelText('No preference')).toBeInTheDocument()
      expect(screen.getByLabelText('Omnivore')).toBeInTheDocument()
      expect(screen.getByLabelText('Vegetarian')).toBeInTheDocument()
      expect(screen.getByLabelText('Vegan')).toBeInTheDocument()
      expect(screen.getByLabelText('Pescatarian')).toBeInTheDocument()
    })

    it('renders allergen checkboxes', () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={true}
        />,
      )

      expect(screen.getByLabelText('Gluten')).toBeInTheDocument()
      expect(screen.getByLabelText('Dairy')).toBeInTheDocument()
      expect(screen.getByLabelText('Eggs')).toBeInTheDocument()
      expect(screen.getByLabelText('Tree nuts')).toBeInTheDocument()
      expect(screen.getByLabelText('Peanuts')).toBeInTheDocument()
      expect(screen.getByLabelText('Soy')).toBeInTheDocument()
      expect(screen.getByLabelText('Fish')).toBeInTheDocument()
      expect(screen.getByLabelText('Shellfish')).toBeInTheDocument()
      expect(screen.getByLabelText('Sesame')).toBeInTheDocument()
    })

    it('renders meal type checkboxes for weekday and weekend', () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={true}
        />,
      )

      // Weekday meals
      expect(screen.getByText('Weekday meals to plan')).toBeInTheDocument()
      // Weekend meals
      expect(screen.getByText('Weekend meals to plan')).toBeInTheDocument()

      // Should have 6 meal type checkboxes (3 weekday + 3 weekend)
      const breakfastCheckboxes = screen.getAllByLabelText('Breakfast')
      const lunchCheckboxes = screen.getAllByLabelText('Lunch')
      const dinnerCheckboxes = screen.getAllByLabelText('Dinner')

      expect(breakfastCheckboxes).toHaveLength(2)
      expect(lunchCheckboxes).toHaveLength(2)
      expect(dinnerCheckboxes).toHaveLength(2)
    })
  })

  describe('owner vs member permissions', () => {
    it('enables name and timezone inputs for owners', () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={true}
        />,
      )

      expect(screen.getByLabelText('Household name')).not.toBeDisabled()
    })

    it('disables name input for non-owners', () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={false}
        />,
      )

      expect(screen.getByLabelText('Household name')).toBeDisabled()
    })

    it('shows owner-only message for non-owners', () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={false}
        />,
      )

      expect(
        screen.getByText('Only the household owner can edit name and timezone.'),
      ).toBeInTheDocument()
    })

    it('does not show owner-only message for owners', () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={true}
        />,
      )

      expect(
        screen.queryByText('Only the household owner can edit name and timezone.'),
      ).not.toBeInTheDocument()
    })

    it('allows non-owners to edit preferences', () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={false}
        />,
      )

      // Allergen checkboxes should not be disabled
      expect(screen.getByLabelText('Gluten')).not.toBeDisabled()
      expect(screen.getByLabelText('Dairy')).not.toBeDisabled()
    })
  })

  describe('initial values from preferences', () => {
    it('shows selected dietary type', () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={{
            ...defaultPreferences,
            dietaryType: 'vegetarian',
          }}
          isOwner={true}
        />,
      )

      expect(screen.getByLabelText('Vegetarian')).toBeChecked()
    })

    it('shows selected allergens', () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={{
            ...defaultPreferences,
            allergensToAvoid: ['gluten', 'dairy'],
          }}
          isOwner={true}
        />,
      )

      expect(screen.getByLabelText('Gluten')).toBeChecked()
      expect(screen.getByLabelText('Dairy')).toBeChecked()
      expect(screen.getByLabelText('Eggs')).not.toBeChecked()
    })

    it('shows selected meal types', () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={{
            ...defaultPreferences,
            weekdayMealTypes: ['breakfast', 'dinner'],
            weekendMealTypes: ['lunch'],
          }}
          isOwner={true}
        />,
      )

      const dinnerCheckboxes = screen.getAllByLabelText('Dinner')
      // First dinner checkbox is weekday
      expect(dinnerCheckboxes[0]).toBeChecked()
      // Second dinner checkbox is weekend
      expect(dinnerCheckboxes[1]).not.toBeChecked()
    })
  })

  describe('form interactions', () => {
    it('updates name input on change', async () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={true}
        />,
      )

      const nameInput = screen.getByLabelText('Household name')
      await userEvent.clear(nameInput)
      await userEvent.type(nameInput, 'New Household Name')

      expect(nameInput).toHaveValue('New Household Name')
    })

    it('toggles allergen checkbox', async () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={true}
        />,
      )

      const glutenCheckbox = screen.getByLabelText('Gluten')
      expect(glutenCheckbox).not.toBeChecked()

      await userEvent.click(glutenCheckbox)
      expect(glutenCheckbox).toBeChecked()

      await userEvent.click(glutenCheckbox)
      expect(glutenCheckbox).not.toBeChecked()
    })

    it('changes dietary type selection', async () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={true}
        />,
      )

      const veganRadio = screen.getByLabelText('Vegan')
      await userEvent.click(veganRadio)

      expect(veganRadio).toBeChecked()
      expect(screen.getByLabelText('No preference')).not.toBeChecked()
    })

    it('renders timezone select with current value', () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={true}
        />,
      )

      // Verify the timezone trigger shows the current value
      const timezoneTrigger = screen.getByRole('combobox', { name: /timezone/i })
      expect(timezoneTrigger).toHaveTextContent('Europe/Tallinn')
    })

    it('disables timezone select for non-owners', () => {
      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={false}
        />,
      )

      const timezoneTrigger = screen.getByRole('combobox', { name: /timezone/i })
      expect(timezoneTrigger).toBeDisabled()
    })
  })

  describe('form submission', () => {
    it('submits form with correct data for owner', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={true}
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

      await waitFor(() => {
        // Owner should make 2 API calls
        expect(mockFetch).toHaveBeenCalledTimes(2)
      })

      // Check household update call
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/households/me',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            name: 'Test Household',
            timezone: 'Europe/Tallinn',
          }),
        }),
      )

      // Check preferences update call
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/households/me/preferences',
        expect.objectContaining({
          method: 'PATCH',
        }),
      )
    })

    it('only submits preferences for non-owner', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={false}
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

      await waitFor(() => {
        // Non-owner should only make 1 API call (preferences)
        expect(mockFetch).toHaveBeenCalledTimes(1)
      })

      expect(mockFetch).toHaveBeenCalledWith('/api/households/me/preferences', expect.anything())

      expect(mockFetch).not.toHaveBeenCalledWith('/api/households/me', expect.anything())
    })

    it('shows success toast on successful save', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={true}
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Settings saved')
      })
    })

    it('shows error message on failed save', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Failed to save' }),
      })

      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={true}
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

      await waitFor(() => {
        expect(screen.getByText('Failed to save')).toBeInTheDocument()
      })
    })

    it('shows loading state during submission', async () => {
      mockFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 500)),
      )

      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={true}
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

      expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
    })

    it('handles network failure gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      render(
        <HouseholdSettingsForm
          household={defaultHousehold}
          preferences={defaultPreferences}
          isOwner={true}
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
    })
  })

  describe('null preferences handling', () => {
    it('handles null preferences gracefully', () => {
      render(
        <HouseholdSettingsForm household={defaultHousehold} preferences={null} isOwner={true} />,
      )

      // Should render with default values
      expect(screen.getByLabelText('No preference')).toBeChecked()
      // Default meal types (dinner)
      const dinnerCheckboxes = screen.getAllByLabelText('Dinner')
      expect(dinnerCheckboxes[0]).toBeChecked()
      expect(dinnerCheckboxes[1]).toBeChecked()
    })
  })
})
