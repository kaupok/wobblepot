import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toast } from 'sonner'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import { HouseholdSettingsForm } from './HouseholdSettingsForm'
import { createQueryWrapper } from '@/test/query-wrapper'

// The global next-intl mock has no `t.rich`, which the allergen notice needs.
// This file already wraps in a real provider with the English catalogue.
vi.unmock('next-intl')

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

const OWNER_ONLY_NOTICE =
  'Only the household owner can change these settings. You can see them here.'

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

function renderForm(
  overrides: Partial<Parameters<typeof HouseholdSettingsForm>[0]> = {},
  locale: 'en' | 'et' = 'en',
) {
  const { wrapper: QueryWrapper, queryClient } = createQueryWrapper()
  const props = {
    household: defaultHousehold,
    preferences: defaultPreferences,
    isOwner: true,
    ...overrides,
  }
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={locale === 'en' ? enMessages : etMessages}>
        <QueryWrapper>{children}</QueryWrapper>
      </NextIntlClientProvider>
    )
  }
  return { ...render(<HouseholdSettingsForm {...props} />, { wrapper: Wrapper }), queryClient }
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
    it('renders the three settings sections in order', () => {
      renderForm()

      const headings = screen.getAllByRole('heading').map((h) => h.textContent)
      expect(headings).toEqual(['Household details', 'Food preferences', 'Meals to plan'])
    })

    /**
     * The page supplies the `<h1>` (`src/app/household/page.tsx`) and the
     * Members list's `<h2>`; each settings section is an `<h2>` beside it, at
     * the Section size, with nothing under it (HON-960). axe's `heading-order`
     * cannot see a section that lost its `as` or kept a Caption-sized `<h3>`.
     */
    it('renders each section as an h2 at the Section size, with no h3', () => {
      renderForm()

      for (const name of ['Household details', 'Food preferences', 'Meals to plan']) {
        const heading = screen.getByRole('heading', { name, level: 2 })
        expect(heading).toHaveClass('text-base', 'font-semibold')
        expect(heading).not.toHaveClass('uppercase')
      }
      expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0)
    })

    it('puts both tag inputs under Food preferences', () => {
      renderForm()

      const food = screen.getByRole('heading', { name: 'Food preferences' }).closest('section')!
      expect(within(food).getByLabelText('Dietary restrictions (optional)')).toBeInTheDocument()
      expect(within(food).getByLabelText('Ingredients to avoid (optional)')).toBeInTheDocument()
    })

    // The language line and the DPIA's allergen notice (HON-666) are the only
    // helper copy left; the tag inputs' placeholders carry their examples.
    it('renders only the language and allergen helper lines', () => {
      const { container } = renderForm()

      const helpers = Array.from(container.querySelectorAll('p.text-muted-foreground')).map(
        (p) => p.textContent,
      )
      expect(helpers).toEqual([
        'Recipes you already have keep their language.',
        expect.stringContaining('Allergens you tick here'),
      ])
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

    it('describes the allergen group with the AI-processing notice and a privacy link', () => {
      renderForm()

      const group = screen.getByRole('group', { name: 'Allergens to avoid' })
      expect(group).toHaveAccessibleDescription(
        'Allergens you tick here are sent to our AI provider so meal plans avoid them. See the privacy policy for details.',
      )
      expect(within(group).getByLabelText('Gluten')).toBeInTheDocument()

      const link = screen.getByRole('link', { name: 'privacy policy' })
      expect(link).toHaveAttribute('href', '/privacy')
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('shows the allergen notice for non-owners too', () => {
      renderForm({ isOwner: false })

      expect(screen.getByRole('group', { name: 'Allergens to avoid' })).toHaveAccessibleDescription(
        /sent to our AI provider/,
      )
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

    // The page shows a member the notice once, under its title (HON-960).
    it('leaves the owner-only message to the page for non-owners', () => {
      renderForm({ isOwner: false })

      expect(screen.queryByText(OWNER_ONLY_NOTICE)).not.toBeInTheDocument()
    })

    // The preferences PATCH is owner-only and 403s a member (HON-677).
    it('disables preferences for non-owners', () => {
      renderForm({ isOwner: false })

      expect(screen.getByLabelText('Gluten')).toBeDisabled()
      expect(screen.getByLabelText('Dairy')).toBeDisabled()
      for (const name of ['No preference', 'Vegetarian', 'Vegan', 'Pescatarian']) {
        expect(screen.getByLabelText(name)).toBeDisabled()
      }
      for (const checkbox of screen.getAllByLabelText('Dinner')) {
        expect(checkbox).toBeDisabled()
      }
      expect(screen.getByLabelText('Dietary restrictions (optional)')).toBeDisabled()
      expect(screen.getByLabelText('Ingredients to avoid (optional)')).toBeDisabled()
    })

    it('enables preferences for owners', () => {
      renderForm({ isOwner: true })

      expect(screen.getByLabelText('Gluten')).not.toBeDisabled()
      expect(screen.getByLabelText('Vegan')).not.toBeDisabled()
      expect(screen.getAllByLabelText('Dinner')[0]).not.toBeDisabled()
    })

    it('hides the save button for non-owners', () => {
      renderForm({ isOwner: false })

      expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument()
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

    it('updates the timezone trigger and saves the new zone', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
      renderForm()

      const timezoneTrigger = screen.getByRole('combobox', { name: /timezone/i })
      await userEvent.click(timezoneTrigger)
      await userEvent.click(screen.getByRole('option', { name: 'America/New York' }))

      expect(timezoneTrigger).toHaveTextContent('America/New York')

      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/households/me',
          expect.objectContaining({
            body: JSON.stringify({
              name: 'Test Household',
              timezone: 'America/New_York',
              locale: 'en',
            }),
          }),
        )
      })
    })

    it('updates the language trigger and saves the new locale', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
      renderForm()

      const localeTrigger = screen.getByRole('combobox', { name: /language/i })
      expect(localeTrigger).toHaveTextContent('English')
      await userEvent.click(localeTrigger)
      await userEvent.click(screen.getByRole('option', { name: 'Estonian' }))

      expect(localeTrigger).toHaveTextContent('Estonian')

      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/households/me',
          expect.objectContaining({
            body: JSON.stringify({
              name: 'Test Household',
              timezone: 'Europe/Tallinn',
              locale: 'et',
            }),
          }),
        )
      })
    })

    it('invalidates the whole query cache before refreshing when the locale changes', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
      const { queryClient } = renderForm()
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

      await userEvent.click(screen.getByRole('combobox', { name: /language/i }))
      await userEvent.click(screen.getByRole('option', { name: 'Estonian' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

      await waitFor(() => expect(mockRouterRefresh).toHaveBeenCalled())
      // No filter: every cached entity carries locale-dependent names.
      expect(invalidate).toHaveBeenCalledWith()
      expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(
        mockRouterRefresh.mock.invocationCallOrder[0]!,
      )
    })

    it('leaves the query cache alone when the locale is unchanged', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
      const { queryClient } = renderForm()
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

      await waitFor(() => expect(mockRouterRefresh).toHaveBeenCalled())
      expect(invalidate).not.toHaveBeenCalled()
    })

    it('disables timezone select for non-owners', () => {
      renderForm({ isOwner: false })

      const timezoneTrigger = screen.getByRole('combobox', { name: /timezone/i })
      expect(timezoneTrigger).toBeDisabled()
    })
  })

  // Radix only mirrors a selected item's text into a childless SelectValue
  // after mount, so the server HTML used to carry empty triggers (HON-761).
  describe('server render', () => {
    it('includes the timezone and language values inside their triggers', () => {
      const html = renderToString(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <QueryClientProvider client={new QueryClient()}>
            <HouseholdSettingsForm
              household={defaultHousehold}
              preferences={defaultPreferences}
              isOwner
            />
          </QueryClientProvider>
        </NextIntlClientProvider>,
      )
      const doc = new DOMParser().parseFromString(html, 'text/html')

      expect(doc.getElementById('timezone')?.textContent).toContain('Europe/Tallinn')
      expect(doc.getElementById('locale')?.textContent).toContain('English')
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

    // No button to press, so submit the form element directly: the mutation
    // itself must refuse, not just the missing button (HON-677).
    it('does not send any request when a non-owner submits', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

      const { container } = renderForm({ isOwner: false })

      fireEvent.submit(container.querySelector('form')!)
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockFetch).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
      expect(mockRouterRefresh).not.toHaveBeenCalled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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

    it('shows catalog copy, not the route error, on a failed save', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Validation failed' }),
      })

      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

      await waitFor(() => {
        expect(screen.getByText(enMessages.household.settings.saveFailed)).toBeInTheDocument()
      })
      expect(screen.queryByText('Validation failed')).not.toBeInTheDocument()
    })

    // An Estonian household must never read the route's English `error`
    // (HON-914), so these render the real `et` catalog.
    describe('in Estonian', () => {
      it('shows the Estonian save failure for a validation error', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: 'Validation failed' }),
        })

        renderForm({}, 'et')

        await userEvent.click(
          screen.getByRole('button', { name: etMessages.household.settings.saveButton }),
        )

        await waitFor(() => {
          expect(screen.getByText(etMessages.household.settings.saveFailed)).toBeInTheDocument()
        })
        expect(screen.queryByText('Validation failed')).not.toBeInTheDocument()
      })

      it('shows the Estonian owner-only notice for a 403', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 403,
          json: () => Promise.resolve({ error: 'Only household owners can update preferences' }),
        })

        renderForm({}, 'et')

        await userEvent.click(
          screen.getByRole('button', { name: etMessages.household.settings.saveButton }),
        )

        await waitFor(() => {
          expect(
            screen.getByText(etMessages.household.settings.ownerOnlyNotice, {
              selector: '#form-error',
            }),
          ).toBeInTheDocument()
        })
        expect(
          screen.queryByText('Only household owners can update preferences'),
        ).not.toBeInTheDocument()
      })
    })

    it('shows loading state during submission', async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ ok: true, json: () => Promise.resolve({}) }), 500),
          ),
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
        expect(screen.getByText(enMessages.household.settings.saveFailed)).toBeInTheDocument()
      })
      expect(screen.queryByText('Network error')).not.toBeInTheDocument()
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
