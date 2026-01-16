import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toast } from 'sonner'
import { MemberPreferencesForm } from './MemberPreferencesForm'

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

const defaultPreferences = {
  displayName: null as string | null,
  portionMultiplier: 1.0,
  targetCalories: null as number | null,
  targetProtein: null as number | null,
  targetCarbs: null as number | null,
  targetFat: null as number | null,
  dietaryType: null as DietaryType | null,
  allergens: [] as Allergen[],
  restrictions: [] as string[],
  excludedIngredients: [] as string[],
}

describe('MemberPreferencesForm', () => {
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
      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      expect(screen.getByText('Display name')).toBeInTheDocument()
      expect(screen.getByText('Portion size')).toBeInTheDocument()
      expect(screen.getByText('Nutritional targets')).toBeInTheDocument()
      expect(screen.getByText('Dietary type')).toBeInTheDocument()
      expect(screen.getByText('Personal restrictions')).toBeInTheDocument()
      expect(screen.getByText('Excluded ingredients')).toBeInTheDocument()
    })

    it('renders display name input with initial value', () => {
      render(
        <MemberPreferencesForm
          preferences={{ ...defaultPreferences, displayName: 'Mom' }}
          householdDietaryType={null}
        />,
      )

      const nameInput = screen.getByLabelText('How you appear in the household')
      expect(nameInput).toHaveValue('Mom')
    })

    it('renders portion size presets', () => {
      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      expect(screen.getByRole('button', { name: 'Small (0.75x)' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Regular (1x)' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Large (1.5x)' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Extra large (2x)' })).toBeInTheDocument()
    })

    it('renders dietary type radio buttons with household option', () => {
      render(
        <MemberPreferencesForm
          preferences={defaultPreferences}
          householdDietaryType="vegetarian"
        />,
      )

      expect(screen.getByLabelText('Use household setting (vegetarian)')).toBeInTheDocument()
      expect(screen.getByLabelText('Omnivore')).toBeInTheDocument()
      expect(screen.getByLabelText('Vegetarian')).toBeInTheDocument()
      expect(screen.getByLabelText('Vegan')).toBeInTheDocument()
      expect(screen.getByLabelText('Pescatarian')).toBeInTheDocument()
    })

    it('renders dietary type without household type shown when null', () => {
      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      expect(screen.getByLabelText('Use household setting')).toBeInTheDocument()
    })
  })

  describe('portion size', () => {
    it('highlights the current portion preset', () => {
      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      const regularButton = screen.getByRole('button', { name: 'Regular (1x)' })
      // Default variant has a different style than outline
      expect(regularButton).not.toHaveClass('border-input')
    })

    it('updates portion multiplier when preset is clicked', async () => {
      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      const largeButton = screen.getByRole('button', { name: 'Large (1.5x)' })
      await userEvent.click(largeButton)

      const customInput = screen.getByLabelText('Custom multiplier')
      expect(customInput).toHaveValue(1.5)
    })

    it('allows custom portion multiplier input', async () => {
      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      const customInput = screen.getByLabelText('Custom multiplier')
      await userEvent.clear(customInput)
      await userEvent.type(customInput, '1.25')

      expect(customInput).toHaveValue(1.25)
    })

    it('shows error for invalid portion range', () => {
      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      const customInput = screen.getByLabelText('Custom multiplier')
      fireEvent.change(customInput, { target: { value: '0.3' } })

      expect(screen.getByText('Portion size must be between 0.5 and 3.0')).toBeInTheDocument()
    })

    it('shows error for portion above maximum', () => {
      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      const customInput = screen.getByLabelText('Custom multiplier')
      fireEvent.change(customInput, { target: { value: '3.5' } })

      expect(screen.getByText('Portion size must be between 0.5 and 3.0')).toBeInTheDocument()
    })
  })

  describe('nutritional targets collapsible', () => {
    it('is closed by default when no targets are set', () => {
      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      expect(screen.queryByLabelText('Daily calories')).not.toBeInTheDocument()
    })

    it('is open when targets are set', () => {
      render(
        <MemberPreferencesForm
          preferences={{ ...defaultPreferences, targetCalories: 2000 }}
          householdDietaryType={null}
        />,
      )

      expect(screen.getByLabelText('Daily calories')).toBeInTheDocument()
      expect(screen.getByLabelText('Daily calories')).toHaveValue(2000)
    })

    it('can be expanded by clicking the header', async () => {
      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      const trigger = screen.getByRole('button', { name: /nutritional targets/i })
      await userEvent.click(trigger)

      expect(screen.getByLabelText('Daily calories')).toBeInTheDocument()
      expect(screen.getByLabelText('Protein (g)')).toBeInTheDocument()
      expect(screen.getByLabelText('Carbs (g)')).toBeInTheDocument()
      expect(screen.getByLabelText('Fat (g)')).toBeInTheDocument()
    })
  })

  describe('dietary type', () => {
    it('defaults to household setting', () => {
      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      expect(screen.getByLabelText('Use household setting')).toBeChecked()
    })

    it('shows selected dietary type from preferences', () => {
      render(
        <MemberPreferencesForm
          preferences={{ ...defaultPreferences, dietaryType: 'vegan' }}
          householdDietaryType={null}
        />,
      )

      expect(screen.getByLabelText('Vegan')).toBeChecked()
    })

    it('allows changing dietary type', async () => {
      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      const pescatarianRadio = screen.getByLabelText('Pescatarian')
      await userEvent.click(pescatarianRadio)

      expect(pescatarianRadio).toBeChecked()
      expect(screen.getByLabelText('Use household setting')).not.toBeChecked()
    })
  })

  describe('tag inputs', () => {
    it('renders existing restrictions', () => {
      render(
        <MemberPreferencesForm
          preferences={{ ...defaultPreferences, restrictions: ['low sodium', 'no spicy'] }}
          householdDietaryType={null}
        />,
      )

      expect(screen.getByText('low sodium')).toBeInTheDocument()
      expect(screen.getByText('no spicy')).toBeInTheDocument()
    })

    it('renders existing excluded ingredients', () => {
      render(
        <MemberPreferencesForm
          preferences={{ ...defaultPreferences, excludedIngredients: ['cilantro', 'olives'] }}
          householdDietaryType={null}
        />,
      )

      expect(screen.getByText('cilantro')).toBeInTheDocument()
      expect(screen.getByText('olives')).toBeInTheDocument()
    })

    it('allows adding a restriction tag', async () => {
      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      const restrictionsInput = screen.getByLabelText('Dietary restrictions')
      await userEvent.type(restrictionsInput, 'low carb{enter}')

      expect(screen.getByText('low carb')).toBeInTheDocument()
    })

    it('allows removing a restriction tag', async () => {
      render(
        <MemberPreferencesForm
          preferences={{ ...defaultPreferences, restrictions: ['low sodium'] }}
          householdDietaryType={null}
        />,
      )

      const removeButton = screen.getByRole('button', { name: 'Remove low sodium' })
      await userEvent.click(removeButton)

      expect(screen.queryByText('low sodium')).not.toBeInTheDocument()
    })
  })

  describe('form submission', () => {
    it('submits form with correct data', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/members/me/preferences',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({
              displayName: null,
              portionMultiplier: 1.0,
              targetCalories: null,
              targetProtein: null,
              targetCarbs: null,
              targetFat: null,
              dietaryType: null,
              allergens: [],
              restrictions: [],
              excludedIngredients: [],
            }),
          }),
        )
      })
    })

    it('submits dietary type as null when household setting is selected', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      render(
        <MemberPreferencesForm
          preferences={defaultPreferences}
          householdDietaryType="vegetarian"
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

      await waitFor(() => {
        const call = mockFetch.mock.calls[0]
        expect(call).toBeDefined()
        const body = JSON.parse(call![1].body)
        expect(body.dietaryType).toBeNull()
      })
    })

    it('submits selected dietary type when not using household setting', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      render(
        <MemberPreferencesForm
          preferences={{ ...defaultPreferences, dietaryType: 'vegan' }}
          householdDietaryType={null}
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

      await waitFor(() => {
        const call = mockFetch.mock.calls[0]
        expect(call).toBeDefined()
        const body = JSON.parse(call![1].body)
        expect(body.dietaryType).toBe('vegan')
      })
    })

    it('shows success toast on successful save', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Preferences saved')
      })
    })

    it('shows error message on failed save', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Failed to save' }),
      })

      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Failed to save')
      })
    })

    it('shows loading state during submission', async () => {
      mockFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 500)),
      )

      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

      expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
    })

    it('handles network failure gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      render(<MemberPreferencesForm preferences={defaultPreferences} householdDietaryType={null} />)

      await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Network error')
      })
    })
  })
})
