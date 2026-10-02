import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import { dropFocusToBody } from '@/test/focus'

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

const ok = () => ({ ok: true, json: () => Promise.resolve({}) })
const fail = (status: number, error: string) => ({
  ok: false,
  status,
  json: () => Promise.resolve({ error }),
})

/** Hold the next request open until the returned function answers it. */
function deferFetch() {
  let answer: (response: unknown) => void = () => {}
  mockFetch.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
  return (response: unknown) => act(() => answer(response))
}

/** The form of the section with this heading. */
function section(heading: string) {
  return screen.getByRole('form', { name: heading })
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

    it('never shows a save button to non-owners', () => {
      renderForm({ isOwner: false })

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
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

  // Each section is its own form, and its Save button shows only while the
  // section differs from what was saved (HON-961).
  describe('save button visibility', () => {
    it('shows no save button at rest', () => {
      renderForm()

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    it('shows one save button, in the changed section only', async () => {
      renderForm()

      await userEvent.click(screen.getByLabelText('Gluten'))

      expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1)
      expect(within(section('Food preferences')).getByRole('button', { name: 'Save' })).toBe(
        screen.getByRole('button', { name: 'Save' }),
      )
    })

    it('shows a save button in each section that has a change', async () => {
      renderForm()

      await userEvent.type(screen.getByLabelText('Household name'), '!')
      await userEvent.click(screen.getAllByLabelText('Lunch')[0]!)

      expect(within(section('Household details')).getByRole('button', { name: 'Save' }))
      expect(within(section('Meals to plan')).getByRole('button', { name: 'Save' }))
      expect(
        within(section('Food preferences')).queryByRole('button', { name: 'Save' }),
      ).not.toBeInTheDocument()
    })

    it('hides the button again when the change is undone', async () => {
      renderForm()

      await userEvent.click(screen.getByLabelText('Gluten'))
      await userEvent.click(screen.getByLabelText('Gluten'))

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    it('ignores the order of a list', async () => {
      renderForm({
        preferences: { ...defaultPreferences, allergensToAvoid: ['gluten', 'dairy'] },
      })

      // Unticking and reticking gluten moves it to the end of the list.
      await userEvent.click(screen.getByLabelText('Gluten'))
      await userEvent.click(screen.getByLabelText('Gluten'))

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    it('does not send anything when a clean section is submitted', async () => {
      renderForm()

      // Enter in the name field submits its form even with no button shown.
      fireEvent.submit(section('Household details'))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('household details', () => {
    it('saves the new timezone, and nothing else, to the household', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm()

      const timezoneTrigger = screen.getByRole('combobox', { name: /timezone/i })
      await userEvent.click(timezoneTrigger)
      await userEvent.click(screen.getByRole('option', { name: 'America/New York' }))
      expect(timezoneTrigger).toHaveTextContent('America/New York')

      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Settings saved'))
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/households/me',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            name: 'Test Household',
            timezone: 'America/New_York',
            locale: 'en',
          }),
        }),
      )
    })

    it('saves the new locale', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm()

      const localeTrigger = screen.getByRole('combobox', { name: /language/i })
      expect(localeTrigger).toHaveTextContent('English')
      await userEvent.click(localeTrigger)
      await userEvent.click(screen.getByRole('option', { name: 'Estonian' }))
      expect(localeTrigger).toHaveTextContent('Estonian')

      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

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
      mockFetch.mockResolvedValue(ok())
      const { queryClient } = renderForm()
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

      await userEvent.click(screen.getByRole('combobox', { name: /language/i }))
      await userEvent.click(screen.getByRole('option', { name: 'Estonian' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(mockRouterRefresh).toHaveBeenCalled())
      // No filter: every cached entity carries locale-dependent names.
      expect(invalidate).toHaveBeenCalledWith()
      expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(
        mockRouterRefresh.mock.invocationCallOrder[0]!,
      )
    })

    it('leaves the query cache alone when the locale is unchanged', async () => {
      mockFetch.mockResolvedValue(ok())
      const { queryClient } = renderForm()
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

      await userEvent.type(screen.getByLabelText('Household name'), '!')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(mockRouterRefresh).toHaveBeenCalled())
      expect(invalidate).not.toHaveBeenCalled()
    })
  })

  describe('food preferences', () => {
    it('saves only the food fields to the preferences', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm()

      await userEvent.click(screen.getByLabelText('Vegan'))
      await userEvent.click(screen.getByLabelText('Gluten'))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(mockRouterRefresh).toHaveBeenCalled())
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/households/me/preferences',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            dietaryType: 'vegan',
            allergensToAvoid: ['gluten'],
            restrictions: [],
            excludedIngredients: [],
          }),
        }),
      )
    })

    it('sends a dietary type of "No preference" as null', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm({ preferences: { ...defaultPreferences, dietaryType: 'vegetarian' } })

      await userEvent.click(screen.getByLabelText('No preference'))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(mockFetch).toHaveBeenCalled())
      expect(JSON.parse(mockFetch.mock.calls[0]![1].body)).toMatchObject({ dietaryType: null })
    })

    // Submitting without the blur a click causes: the tag is still only text.
    it('sends text typed into a tag input but not yet added', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm()

      await userEvent.click(screen.getByLabelText('Gluten'))
      await userEvent.type(screen.getByLabelText('Dietary restrictions (optional)'), 'halal')
      fireEvent.submit(section('Food preferences'))

      await waitFor(() => expect(mockFetch).toHaveBeenCalled())
      expect(JSON.parse(mockFetch.mock.calls[0]![1].body)).toMatchObject({
        restrictions: ['halal'],
      })
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(),
      )
    })
  })

  describe('meals to plan', () => {
    it('saves only the meal types to the preferences', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm()

      await userEvent.click(screen.getAllByLabelText('Breakfast')[1]!)
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(mockRouterRefresh).toHaveBeenCalled())
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/households/me/preferences',
        expect.objectContaining({
          body: JSON.stringify({
            weekdayMealTypes: ['dinner'],
            weekendMealTypes: ['dinner', 'breakfast'],
          }),
        }),
      )
    })

    it('labels each day group', () => {
      renderForm()

      const weekday = screen.getByRole('group', { name: 'Weekday meals to plan' })
      expect(within(weekday).getByLabelText('Dinner')).toBeChecked()
      expect(screen.getByRole('group', { name: 'Weekend meals to plan' })).toBeInTheDocument()
    })
  })

  describe('after a save', () => {
    it('removes the button and moves focus to the section heading', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm()

      await userEvent.click(screen.getByLabelText('Gluten'))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(),
      )
      expect(screen.getByRole('heading', { name: 'Food preferences' })).toHaveFocus()
      expect(toast.success).toHaveBeenCalledWith('Settings saved')
    })

    it('treats the sent values as saved', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm()

      await userEvent.click(screen.getByLabelText('Gluten'))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(),
      )

      // Unticking now differs from the new saved value, not the original one.
      await userEvent.click(screen.getByLabelText('Gluten'))
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    })

    it('leaves focus alone when the user has moved to another section', async () => {
      const respond = deferFetch()
      renderForm()

      await userEvent.click(screen.getByLabelText('Gluten'))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      const nameInput = screen.getByLabelText('Household name')
      act(() => nameInput.focus())
      respond(ok())

      await waitFor(() => expect(toast.success).toHaveBeenCalled())
      expect(nameInput).toHaveFocus()
    })

    it('shows the saving state while the request is pending', async () => {
      deferFetch()
      renderForm()

      await userEvent.click(screen.getByLabelText('Gluten'))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
      expect(screen.getByLabelText('Gluten')).toBeDisabled()
      // The other sections stay editable.
      expect(screen.getByLabelText('Household name')).not.toBeDisabled()
    })
  })

  describe('after a failed save', () => {
    it('shows catalog copy under the section, not the route error', async () => {
      mockFetch.mockResolvedValue(fail(400, 'Validation failed'))
      renderForm()

      await userEvent.type(screen.getByLabelText('Household name'), '!')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      const details = section('Household details')
      await waitFor(() => {
        expect(within(details).getByRole('alert')).toHaveTextContent(
          enMessages.household.settings.saveFailed,
        )
      })
      expect(screen.queryByText('Validation failed')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Household name')).toHaveAccessibleDescription(
        enMessages.household.settings.saveFailed,
      )
      expect(within(details).getByRole('button', { name: 'Save' })).toBeInTheDocument()
    })

    it('returns focus to the save button', async () => {
      const respond = deferFetch()
      renderForm()

      await userEvent.click(screen.getByLabelText('Gluten'))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      // Chromium blurs the button once it is disabled; jsdom does not.
      dropFocusToBody()
      respond(fail(500, 'Failed to update household preferences'))

      await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus())
    })

    it('handles a network failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))
      renderForm()

      await userEvent.click(screen.getAllByLabelText('Lunch')[0]!)
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(within(section('Meals to plan')).getByRole('alert')).toHaveTextContent(
          enMessages.household.settings.saveFailed,
        )
      })
      expect(screen.queryByText('Network error')).not.toBeInTheDocument()
    })

    // No button to press, so submit the form element directly: the section
    // itself must refuse, not just the missing button (HON-677).
    it('does not send any request when a non-owner submits', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm({ isOwner: false })

      for (const form of screen.getAllByRole('form')) fireEvent.submit(form)
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockFetch).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
      expect(mockRouterRefresh).not.toHaveBeenCalled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    // An Estonian household must never read the route's English `error`
    // (HON-914), so these render the real `et` catalog.
    describe('in Estonian', () => {
      const et = etMessages.household.settings

      it('shows the Estonian save failure for a validation error', async () => {
        mockFetch.mockResolvedValue(fail(400, 'Validation failed'))
        renderForm({}, 'et')

        await userEvent.type(screen.getByLabelText(et.nameLabel), '!')
        await userEvent.click(screen.getByRole('button', { name: et.saveButton }))

        await waitFor(() => expect(screen.getByText(et.saveFailed)).toBeInTheDocument())
        expect(screen.queryByText('Validation failed')).not.toBeInTheDocument()
      })

      it('shows the Estonian owner-only notice for a 403', async () => {
        mockFetch.mockResolvedValue(fail(403, 'Only household owners can update preferences'))
        renderForm({}, 'et')

        await userEvent.click(screen.getAllByLabelText(etMessages.enums.MealType.lunch)[0]!)
        await userEvent.click(screen.getByRole('button', { name: et.saveButton }))

        await waitFor(() => {
          expect(
            screen.getByText(et.ownerOnlyNotice, { selector: '#meals-error' }),
          ).toBeInTheDocument()
        })
        expect(
          screen.queryByText('Only household owners can update preferences'),
        ).not.toBeInTheDocument()
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
