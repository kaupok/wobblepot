import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toast } from 'sonner'
import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../../messages/en.json'
import { HouseholdSettingsForm } from './HouseholdSettingsForm'
import { createQueryWrapper } from '@/test/query-wrapper'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockRouterRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: mockRouterRefresh,
  }),
}))

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

type DietaryType = 'vegetarian' | 'vegan' | 'pescatarian'
type Allergen =
  'gluten' | 'dairy' | 'eggs' | 'nuts' | 'peanuts' | 'soy' | 'fish' | 'shellfish' | 'sesame'
type MealType = 'breakfast' | 'lunch' | 'dinner'

const defaultHousehold = {
  id: 'household-1',
  name: 'Test Household',
  timezone: 'Europe/Tallinn',
  locale: 'en' as const,
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

function renderForm(overrides: Partial<Parameters<typeof HouseholdSettingsForm>[0]> = {}) {
  const { wrapper: QueryWrapper } = createQueryWrapper()
  const props = {
    household: defaultHousehold,
    preferences: defaultPreferences,
    isOwner: true,
    ...overrides,
  }
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <QueryWrapper>{children}</QueryWrapper>
      </NextIntlClientProvider>
    )
  }
  return render(<HouseholdSettingsForm {...props} />, { wrapper: Wrapper })
}

describe('HouseholdSettingsForm', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockRouterRefresh.mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
    // Radix Select calls pointer-capture APIs that jsdom doesn't implement.
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.releasePointerCapture = vi.fn()
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders all form sections', () => {
      renderForm()

      expect(screen.getByText('Basic information')).toBeInTheDocument()
      expect(screen.getByText('Dietary preferences')).toBeInTheDocument()
      expect(screen.getByText('Excluded ingredients')).toBeInTheDocument()
      expect(screen.getByText('Meal scheduling')).toBeInTheDocument()
    })

    /**
     * The page supplies the `<h1>` (`src/app/household/page.tsx`), this form's
     * title is the `<h2>`, and its sections are `<h3>` — an unbroken outline
     * that axe's heading-order rule checks in Storybook. The `level` assertions
     * are what catch a `variant="section"` swap that forgets `as`: `section`
     * defaults to `<h2>`, which would put every section level with the title it
     * belongs to. See HON-613.
     */
    it('renders each section one level below the form title', () => {
      renderForm()

      expect(
        screen.getByRole('heading', { name: 'Household settings', level: 2 }),
      ).toBeInTheDocument()

      for (const name of [
        'Basic information',
        'Dietary preferences',
        'Excluded ingredients',
        'Meal scheduling',
      ]) {
        expect(screen.getByRole('heading', { name, level: 3 })).toBeInTheDocument()
      }
    })

    it('renders household name input with initial value', () => {
      renderForm()

      const nameInput = screen.getByLabelText('Household name')
      expect(nameInput).toHaveValue('Test Household')
    })

    it('renders dietary type radio buttons', () => {
      renderForm()

      expect(screen.getByLabelText('No preference')).toBeInTheDocument()
      expect(screen.getByLabelText('Vegetarian')).toBeInTheDocument()
      expect(screen.getByLabelText('Vegan')).toBeInTheDocument()
      expect(screen.getByLabelText('Pescatarian')).toBeInTheDocument()
    })

    it('renders allergen checkboxes', () => {
      renderForm()

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
      renderForm()

      expect(screen.getByText('Weekday meals to plan')).toBeInTheDocument()
      expect(screen.getByText('Weekend meals to plan')).toBeInTheDocument()

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
      renderForm({ isOwner: true })

      expect(screen.getByLabelText('Household name')).not.toBeDisabled()
    })

    it('disables name input for non-owners', () => {
      renderForm({ isOwner: false })

      expect(screen.getByLabelText('Household name')).toBeDisabled()
    })

    it('shows owner-only message for non-owners', () => {
      renderForm({ isOwner: false })

      expect(
        screen.getByText('Only the household owner can edit name, timezone, and language.'),
      ).toBeInTheDocument()
    })

    it('does not show owner-only message for owners', () => {
      renderForm({ isOwner: true })

      expect(
        screen.queryByText('Only the household owner can edit name, timezone, and language.'),
      ).not.toBeInTheDocument()
    })

    it('allows non-owners to edit preferences', () => {
      renderForm({ isOwner: false })

      expect(screen.getByLabelText('Gluten')).not.toBeDisabled()
      expect(screen.getByLabelText('Dairy')).not.toBeDisabled()
    })
  })

  describe('initial values from preferences', () => {
    it('shows selected dietary type', () => {
      renderForm({
        preferences: { ...defaultPreferences, dietaryType: 'vegetarian' },
      })

      expect(screen.getByLabelText('Vegetarian')).toBeChecked()
    })

    it('shows selected allergens', () => {
      renderForm({
        preferences: { ...defaultPreferences, allergensToAvoid: ['gluten', 'dairy'] },
      })

      expect(screen.getByLabelText('Gluten')).toBeChecked()
      expect(screen.getByLabelText('Dairy')).toBeChecked()
      expect(screen.getByLabelText('Eggs')).not.toBeChecked()
    })

    it('shows selected meal types', () => {
      renderForm({
        preferences: {
          ...defaultPreferences,
          weekdayMealTypes: ['breakfast', 'dinner'],
          weekendMealTypes: ['lunch'],
        },
      })

      const dinnerCheckboxes = screen.getAllByLabelText('Dinner')
      expect(dinnerCheckboxes[0]).toBeChecked()
      expect(dinnerCheckboxes[1]).not.toBeChecked()
    })
  })

  describe('form interactions', () => {
    it('updates name input on change', async () => {
      renderForm()

      const nameInput = screen.getByLabelText('Household name')
      await userEvent.clear(nameInput)
      await userEvent.type(nameInput, 'New Household Name')

      expect(nameInput).toHaveValue('New Household Name')
    })

    it('toggles allergen checkbox', async () => {
      renderForm()

      const glutenCheckbox = screen.getByLabelText('Gluten')
      expect(glutenCheckbox).not.toBeChecked()

      await userEvent.click(glutenCheckbox)
      expect(glutenCheckbox).toBeChecked()

      await userEvent.click(glutenCheckbox)
      expect(glutenCheckbox).not.toBeChecked()
    })

    it('changes dietary type selection', async () => {
      renderForm()

      const veganRadio = screen.getByLabelText('Vegan')
      await userEvent.click(veganRadio)

      expect(veganRadio).toBeChecked()
      expect(screen.getByLabelText('No preference')).not.toBeChecked()
    })

    it('renders timezone select with current value', () => {
      renderForm()

      const timezoneTrigger = screen.getByRole('combobox', { name: /timezone/i })
      expect(timezoneTrigger).toHaveTextContent('Europe/Tallinn')
    })

    it('disables timezone select for non-owners', () => {
      renderForm({ isOwner: false })

      const timezoneTrigger = screen.getByRole('combobox', { name: /timezone/i })
      expect(timezoneTrigger).toBeDisabled()
    })
  })

  describe('form submission', () => {
    it('submits form with correct data for owner', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      renderForm({ isOwner: true })

      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2)
      })

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/households/me',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            name: 'Test Household',
            timezone: 'Europe/Tallinn',
            locale: 'en',
          }),
        }),
      )

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/households/me/preferences',
        expect.objectContaining({
          method: 'PATCH',
        }),
      )
    })

    it('only submits preferences for non-owner', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      renderForm({ isOwner: false })

      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1)
      })

      expect(mockFetch).toHaveBeenCalledWith('/api/households/me/preferences', expect.anything())
      expect(mockFetch).not.toHaveBeenCalledWith('/api/households/me', expect.anything())
    })

    it('shows success toast on successful save', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Settings saved')
      })
    })

    it('calls router.refresh on successful save so SSR chrome picks up locale', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

      await waitFor(() => {
        expect(mockRouterRefresh).toHaveBeenCalled()
      })
    })

    it('shows error message on failed save', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Failed to save' }),
      })

      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

      await waitFor(() => {
        expect(screen.getByText('Failed to save')).toBeInTheDocument()
      })
    })

    it('shows loading state during submission', async () => {
      mockFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 500)),
      )

      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    })

    it('handles network failure gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
    })
  })

  describe('null preferences handling', () => {
    it('handles null preferences gracefully', () => {
      renderForm({ preferences: null })

      expect(screen.getByLabelText('No preference')).toBeChecked()
      const dinnerCheckboxes = screen.getAllByLabelText('Dinner')
      expect(dinnerCheckboxes[0]).toBeChecked()
      expect(dinnerCheckboxes[1]).toBeChecked()
    })
  })

  describe('locale selector', () => {
    it('exposes English and Estonian as selectable options', async () => {
      renderForm({ household: { ...defaultHousehold, locale: 'en' } })

      const localeTrigger = screen.getByRole('combobox', { name: /language/i })
      await userEvent.click(localeTrigger)

      const englishOption = await screen.findByRole('option', { name: 'English' })
      const estonianOption = await screen.findByRole('option', { name: 'Estonian' })

      expect(englishOption).not.toHaveAttribute('aria-disabled', 'true')
      expect(estonianOption).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('reflects the household locale on the trigger', () => {
      renderForm({ household: { ...defaultHousehold, locale: 'et' } })

      const localeTrigger = screen.getByRole('combobox', { name: /language/i })
      expect(localeTrigger).toHaveTextContent('Estonian')
    })
  })
})
