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
    reminderWeekday: null,
    reminderConfirmed: false,
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
    it('renders the four settings sections in order', () => {
      renderForm()

      const headings = screen.getAllByRole('heading').map((h) => h.textContent)
      expect(headings).toEqual([
        'Household details',
        'Food preferences',
        'Meals to plan',
        'Weekly reminder',
      ])
    })

    /**
     * The page supplies the `<h1>` (`src/app/household/page.tsx`) and the
     * Members list's `<h2>`; each settings section is an `<h2>` beside it, at
     * the Section size, with nothing under it (HON-960). axe's `heading-order`
     * cannot see a section that lost its `as` or kept a Caption-sized `<h3>`.
     */
    it('renders each section as an h2 at the Section size, with no h3', () => {
      renderForm()

      for (const name of [
        'Household details',
        'Food preferences',
        'Meals to plan',
        'Weekly reminder',
      ]) {
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

    // The language line, the DPIA's allergen notice (HON-666) and what the
    // weekly reminder sends (HON-1084) are the only helper copy; the tag
    // inputs' placeholders carry their examples.
    it('renders only the language, allergen and reminder helper lines', () => {
      const { container } = renderForm()

      const helpers = Array.from(container.querySelectorAll('p.text-muted-foreground')).map(
        (p) => p.textContent,
      )
      expect(helpers).toEqual([
        'Recipes you already have keep their language.',
        expect.stringContaining('Allergens you tick here'),
        enMessages.household.settings.reminderHelper,
      ])
    })

    it('renders household name input with initial value', () => {
      renderForm()

      const nameInput = screen.getByLabelText('Household name')
      expect(nameInput).toHaveValue('Test Household')
    })

    it('renders dietary type as a radio group of four chips, one checked', () => {
      renderForm()

      const group = screen.getByRole('radiogroup', { name: 'Dietary type' })
      const radios = within(group).getAllByRole('radio')
      expect(radios.map((radio) => radio.textContent)).toEqual([
        'No preference',
        'Vegetarian',
        'Vegan',
        'Pescatarian',
      ])
      expect(radios.filter((radio) => radio.getAttribute('aria-checked') === 'true')).toEqual([
        within(group).getByRole('radio', { name: 'No preference' }),
      ])
    })

    it('moves the dietary choice with the arrow keys', async () => {
      renderForm()

      // Radix checks the newly focused radio only while the arrow is still
      // down, a tick after keydown: hold it (as `choice-chips.stories.tsx`).
      await userEvent.click(screen.getByRole('radio', { name: 'No preference' }))
      await userEvent.keyboard('{ArrowRight>}')
      await waitFor(() => expect(screen.getByRole('radio', { name: 'Vegetarian' })).toHaveFocus())
      await userEvent.keyboard('{/ArrowRight}')

      expect(screen.getByRole('radio', { name: 'Vegetarian' })).toBeChecked()
      expect(screen.getByRole('radio', { name: 'No preference' })).not.toBeChecked()
    })

    it('renders the allergens as nine toggle buttons in a wrapping row', () => {
      renderForm()

      const group = screen.getByRole('group', { name: 'Allergens to avoid' })
      const toggles = within(group).getAllByRole('button')
      expect(toggles.map((toggle) => toggle.textContent)).toEqual([
        'Gluten',
        'Dairy',
        'Eggs',
        'Tree nuts',
        'Peanuts',
        'Soy',
        'Fish',
        'Shellfish',
        'Sesame',
      ])
      for (const toggle of toggles) {
        expect(toggle).toHaveAttribute('aria-pressed', 'false')
        // 44px on a phone (HON-962).
        expect(toggle).toHaveClass('h-touch')
      }
      expect(group).toHaveClass('flex-wrap')
    })

    it('describes the allergen group with the AI-processing notice and a privacy link', () => {
      renderForm()

      const group = screen.getByRole('group', { name: 'Allergens to avoid' })
      expect(group).toHaveAccessibleDescription(
        'Allergens you tick here are sent to our AI provider so meal plans avoid them. See the privacy policy for details.',
      )
      expect(within(group).getByRole('button', { name: 'Gluten' })).toBeInTheDocument()

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

    it('renders meals to plan as one grid: meals as columns, day groups as rows', () => {
      renderForm()

      const table = screen.getByRole('table', { name: 'Meals to plan' })
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((head) => head.textContent),
      ).toEqual(['Breakfast', 'Lunch', 'Dinner'])
      // Each day group has a row head beside its checkboxes from `sm` up, and
      // one on its own row above them on a phone. CSS shows one of the two;
      // jsdom applies no Tailwind, so both are in its tree.
      const [aboveWeekdays, besideWeekdays] = within(table).getAllByRole('rowheader', {
        name: 'Weekdays',
      })
      expect(besideWeekdays).toHaveClass('max-sm:hidden')
      expect(aboveWeekdays!.closest('tr')).toHaveClass('sm:hidden')
      expect(aboveWeekdays).toHaveAttribute('colspan', '3')
      expect(within(table).getAllByRole('rowheader', { name: 'Weekends' })).toHaveLength(2)

      // Each checkbox names both axes, so it reads outside the table context.
      for (const day of ['Weekdays', 'Weekends']) {
        for (const meal of ['Breakfast', 'Lunch', 'Dinner']) {
          expect(within(table).getByRole('checkbox', { name: `${day}: ${meal}` })).toBeVisible()
        }
      }
      // The i18n smoke spec and older selectors find a cell by this id.
      expect(screen.getByLabelText('Weekdays: Breakfast')).toHaveAttribute(
        'id',
        'weekday-breakfast',
      )
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

      expect(screen.getByRole('button', { name: 'Gluten' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Dairy' })).toBeDisabled()
      for (const name of ['No preference', 'Vegetarian', 'Vegan', 'Pescatarian']) {
        expect(screen.getByRole('radio', { name })).toBeDisabled()
      }
      // The meal grid's checkboxes; the weekly reminder's is the member's own.
      for (const checkbox of within(section('Meals to plan')).getAllByRole('checkbox')) {
        expect(checkbox).toBeDisabled()
      }
      expect(screen.getByLabelText('Dietary restrictions (optional)')).toBeDisabled()
      expect(screen.getByLabelText('Ingredients to avoid (optional)')).toBeDisabled()
    })

    it('enables preferences for owners', () => {
      renderForm({ isOwner: true })

      expect(screen.getByRole('button', { name: 'Gluten' })).not.toBeDisabled()
      expect(screen.getByRole('radio', { name: 'Vegan' })).not.toBeDisabled()
      expect(screen.getByLabelText('Weekdays: Dinner')).not.toBeDisabled()
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

      expect(screen.getByRole('radio', { name: 'Vegetarian' })).toBeChecked()
    })

    it('shows selected allergens', () => {
      renderForm({
        preferences: { ...defaultPreferences, allergensToAvoid: ['gluten', 'dairy'] },
      })

      expect(screen.getByRole('button', { name: 'Gluten' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'Dairy' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'Eggs' })).toHaveAttribute('aria-pressed', 'false')
    })

    it('shows selected meal types', () => {
      renderForm({
        preferences: {
          ...defaultPreferences,
          weekdayMealTypes: ['breakfast', 'dinner'],
          weekendMealTypes: ['lunch'],
        },
      })

      expect(screen.getByLabelText('Weekdays: Breakfast')).toBeChecked()
      expect(screen.getByLabelText('Weekdays: Lunch')).not.toBeChecked()
      expect(screen.getByLabelText('Weekdays: Dinner')).toBeChecked()
      expect(screen.getByLabelText('Weekends: Lunch')).toBeChecked()
      expect(screen.getByLabelText('Weekends: Dinner')).not.toBeChecked()
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

    it('toggles an allergen, with a check icon while pressed', async () => {
      renderForm()

      const gluten = screen.getByRole('button', { name: 'Gluten' })
      const icon = () => gluten.querySelector('[data-slot="toggle-indicator"]')
      expect(gluten).toHaveAttribute('aria-pressed', 'false')

      await userEvent.click(gluten)
      expect(gluten).toHaveAttribute('aria-pressed', 'true')
      // Hidden by CSS until pressed; jsdom does not apply Tailwind, so assert
      // the hook the CSS reads.
      expect(gluten).toHaveAttribute('data-state', 'on')
      expect(icon()).toHaveClass('group-data-[state=on]/toggle:block')

      await userEvent.click(gluten)
      expect(gluten).toHaveAttribute('aria-pressed', 'false')
    })

    it('changes dietary type selection', async () => {
      renderForm()

      const veganRadio = screen.getByRole('radio', { name: 'Vegan' })
      await userEvent.click(veganRadio)

      expect(veganRadio).toBeChecked()
      expect(screen.getByRole('radio', { name: 'No preference' })).not.toBeChecked()
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
              reminderWeekday={7}
              reminderConfirmed
            />
          </QueryClientProvider>
        </NextIntlClientProvider>,
      )
      const doc = new DOMParser().parseFromString(html, 'text/html')

      expect(doc.getElementById('timezone')?.textContent).toContain('Europe/Tallinn')
      expect(doc.getElementById('locale')?.textContent).toContain('English')
      expect(doc.getElementById('reminder-weekday')?.textContent).toContain('Sunday')
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

      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))

      expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1)
      expect(within(section('Food preferences')).getByRole('button', { name: 'Save' })).toBe(
        screen.getByRole('button', { name: 'Save' }),
      )
    })

    it('shows a save button in each section that has a change', async () => {
      renderForm()

      await userEvent.type(screen.getByLabelText('Household name'), '!')
      await userEvent.click(screen.getByLabelText('Weekdays: Lunch'))

      expect(within(section('Household details')).getByRole('button', { name: 'Save' }))
      expect(within(section('Meals to plan')).getByRole('button', { name: 'Save' }))
      expect(
        within(section('Food preferences')).queryByRole('button', { name: 'Save' }),
      ).not.toBeInTheDocument()
    })

    it('hides the button again when the change is undone', async () => {
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))
      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    it('ignores the order of a list', async () => {
      renderForm({
        preferences: { ...defaultPreferences, allergensToAvoid: ['gluten', 'dairy'] },
      })

      // Unticking and reticking gluten moves it to the end of the list.
      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))
      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))

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

      await userEvent.click(screen.getByRole('radio', { name: 'Vegan' }))
      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))
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

      await userEvent.click(screen.getByRole('radio', { name: 'No preference' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(mockFetch).toHaveBeenCalled())
      expect(JSON.parse(mockFetch.mock.calls[0]![1].body)).toMatchObject({ dietaryType: null })
    })

    // Submitting without the blur a click causes: the tag is still only text.
    it('sends text typed into a tag input but not yet added', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))
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

      await userEvent.click(screen.getByLabelText('Weekends: Breakfast'))
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

    // The route rejects an empty list; say what to fix instead of its 400.
    it('asks for at least one meal type per group without sending', async () => {
      renderForm()

      const weekdayDinner = screen.getByLabelText('Weekdays: Dinner')
      await userEvent.click(weekdayDinner)
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(within(section('Meals to plan')).getByRole('alert')).toHaveTextContent(
        enMessages.household.settings.mealsRequired,
      )
      expect(weekdayDinner).toHaveAccessibleDescription(enMessages.household.settings.mealsRequired)
      expect(mockFetch).not.toHaveBeenCalled()

      // Fixing it clears the message straight away.
      await userEvent.click(screen.getByLabelText('Weekdays: Lunch'))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(weekdayDinner).not.toHaveAccessibleDescription()
    })
  })

  describe('weekly reminder', () => {
    const settings = enMessages.household.settings

    it('is off by default, with no weekday select', () => {
      renderForm()

      const form = section('Weekly reminder')
      expect(
        within(form).getByRole('checkbox', { name: settings.reminderToggle }),
      ).not.toBeChecked()
      expect(within(form).queryByRole('combobox')).not.toBeInTheDocument()
      expect(within(form).getByRole('checkbox')).toHaveAccessibleDescription(
        settings.reminderHelper,
      )
    })

    it('switches on with Sunday and saves the weekday to its own route', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm()

      const form = section('Weekly reminder')
      await userEvent.click(within(form).getByRole('checkbox', { name: settings.reminderToggle }))
      expect(within(form).getByRole('combobox', { name: 'Day' })).toHaveTextContent('Sunday')
      await userEvent.click(within(form).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(mockRouterRefresh).toHaveBeenCalled())
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/households/me/members/me/reminder',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ weekday: 7 }) }),
      )
    })

    describe('the confirm step (HON-1113)', () => {
      it('says an email is waiting while the reminder is on and the address is not confirmed', () => {
        renderForm({ reminderWeekday: 7, reminderConfirmed: false })

        const form = section('Weekly reminder')
        expect(within(form).getByText(settings.reminderAwaitingConfirm)).toBeInTheDocument()
        expect(
          within(form).getByRole('checkbox', { name: settings.reminderToggle }),
        ).toHaveAccessibleDescription(
          `${settings.reminderHelper} ${settings.reminderAwaitingConfirm}`,
        )
      })

      it.each([
        ['on and confirmed', { reminderWeekday: 7 as const, reminderConfirmed: true }],
        ['off and unconfirmed', { reminderWeekday: null, reminderConfirmed: false }],
        ['off and confirmed', { reminderWeekday: null, reminderConfirmed: true }],
      ])('says nothing about an email when %s', (_label, props) => {
        renderForm(props)

        expect(screen.queryByText(settings.reminderAwaitingConfirm)).not.toBeInTheDocument()
      })

      it('shows the line once the switch-on is saved, not on the tick', async () => {
        mockFetch.mockResolvedValue(ok())
        renderForm()

        const form = section('Weekly reminder')
        await userEvent.click(within(form).getByRole('checkbox', { name: settings.reminderToggle }))
        expect(within(form).queryByText(settings.reminderAwaitingConfirm)).not.toBeInTheDocument()
        await userEvent.click(within(form).getByRole('button', { name: 'Save' }))

        expect(await within(form).findByText(settings.reminderAwaitingConfirm)).toBeInTheDocument()
      })
    })

    it('saves another weekday picked from the select', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm({ reminderWeekday: 7 })

      const form = section('Weekly reminder')
      await userEvent.click(within(form).getByRole('combobox', { name: 'Day' }))
      await userEvent.click(await screen.findByRole('option', { name: 'Wednesday' }))
      await userEvent.click(within(form).getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/households/me/members/me/reminder',
          expect.objectContaining({ body: JSON.stringify({ weekday: 3 }) }),
        ),
      )
    })

    it('switches off with null', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm({ reminderWeekday: 5 })

      const form = section('Weekly reminder')
      expect(within(form).getByRole('combobox', { name: 'Day' })).toHaveTextContent('Friday')
      await userEvent.click(within(form).getByRole('checkbox', { name: settings.reminderToggle }))
      expect(within(form).queryByRole('combobox')).not.toBeInTheDocument()
      await userEvent.click(within(form).getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/households/me/members/me/reminder',
          expect.objectContaining({ body: JSON.stringify({ weekday: null }) }),
        ),
      )
    })

    // The consent is the member's own, so the owner-only rule does not apply.
    it('lets a member who is not the owner save it, and says so', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm({ isOwner: false })

      const form = section('Weekly reminder')
      expect(within(form).getByText(settings.reminderOwnNotice)).toBeInTheDocument()
      const toggle = within(form).getByRole('checkbox', { name: settings.reminderToggle })
      expect(toggle).toBeEnabled()
      await userEvent.click(toggle)
      await userEvent.click(within(form).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    })

    it('shows the generic save failure, not the owner-only notice, for a member', async () => {
      mockFetch.mockResolvedValue(fail(500, 'Failed to save the reminder'))
      renderForm({ isOwner: false })

      const form = section('Weekly reminder')
      await userEvent.click(within(form).getByRole('checkbox', { name: settings.reminderToggle }))
      await userEvent.click(within(form).getByRole('button', { name: 'Save' }))

      expect(await within(form).findByText(settings.saveFailed)).toBeInTheDocument()
      expect(within(form).queryByText(OWNER_ONLY_NOTICE)).not.toBeInTheDocument()
    })

    it('names the weekdays in the household language', () => {
      renderForm({ reminderWeekday: 7 }, 'et')

      const form = section(etMessages.household.settings.reminderHeading)
      expect(
        within(form).getByRole('combobox', {
          name: etMessages.household.settings.reminderWeekdayLabel,
        }),
      ).toHaveTextContent('Pühapäev')
    })
  })

  describe('after a save', () => {
    it('removes the button and moves focus to the section heading', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))
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

      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(),
      )

      // Unticking now differs from the new saved value, not the original one.
      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    })

    it('leaves focus alone when the user has moved to another section', async () => {
      const respond = deferFetch()
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))
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

      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Gluten' })).toBeDisabled()
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

    // With the button gone there is nothing to retry, so the error goes too.
    it('clears the error when the change is undone', async () => {
      mockFetch.mockResolvedValue(fail(500, 'Failed to update household'))
      renderForm()

      const nameInput = screen.getByLabelText('Household name')
      await userEvent.type(nameInput, '!')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

      await userEvent.type(nameInput, '{Backspace}')

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(nameInput).not.toHaveAttribute('aria-invalid', 'true')
      expect(nameInput).not.toHaveAccessibleDescription()

      // A new edit is not the change that failed, so the error stays gone.
      await userEvent.type(nameInput, '?')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(nameInput).not.toHaveAttribute('aria-invalid', 'true')
    })

    it('returns focus to the save button', async () => {
      const respond = deferFetch()
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      // Chromium blurs the button once it is disabled; jsdom does not.
      dropFocusToBody()
      respond(fail(500, 'Failed to update household preferences'))

      await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus())
    })

    it('leaves focus alone on a failure when the user has moved to another section', async () => {
      const respond = deferFetch()
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      const nameInput = screen.getByLabelText('Household name')
      act(() => nameInput.focus())
      respond(fail(500, 'Failed to update household preferences'))

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
      expect(nameInput).toHaveFocus()
    })

    it('handles a network failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))
      renderForm()

      await userEvent.click(screen.getByLabelText('Weekdays: Lunch'))
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

        await userEvent.click(
          screen.getByLabelText(
            `${etMessages.household.settings.weekdaysRow}: ${etMessages.enums.MealType.lunch}`,
          ),
        )
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

      expect(screen.getByRole('radio', { name: 'No preference' })).toBeChecked()
      expect(screen.getByLabelText('Weekdays: Dinner')).toBeChecked()
      expect(screen.getByLabelText('Weekends: Dinner')).toBeChecked()
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
