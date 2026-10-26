import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toast } from 'sonner'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import { FoodPreferencesForm } from './FoodPreferencesForm'
import { MealsToPlanForm } from './MealsToPlanForm'
import {
  OWNER_ONLY_NOTICE,
  deferFetch,
  defaultPreferences,
  fail,
  mockFetch,
  ok,
  renderSettings,
  section,
  stubPointerApis,
} from '@/test/household-settings'

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

global.fetch = mockFetch

function renderForm(
  overrides: Partial<Parameters<typeof MealsToPlanForm>[0]> = {},
  locale: 'en' | 'et' = 'en',
) {
  return renderSettings(
    <MealsToPlanForm preferences={defaultPreferences} isOwner {...overrides} />,
    locale,
  )
}

/** Both forms, in the order the Meal preferences tab renders them (HON-1257). */
function renderTab(overrides: Partial<Parameters<typeof MealsToPlanForm>[0]> = {}) {
  const props = { preferences: defaultPreferences, isOwner: true, ...overrides }
  return renderSettings(
    <>
      <FoodPreferencesForm {...props} excludedMatches={[]} />
      <MealsToPlanForm {...props} />
    </>,
  )
}

/**
 * Household → Meal preferences (HON-1257): the Meals to plan cases of the old
 * `HouseholdSettingsForm.test.tsx`, plus the cases that need a second section
 * beside it, which on this tab is Food preferences, above it.
 */
describe('MealsToPlanForm', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockRouterRefresh.mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
    stubPointerApis()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    // An h2 under the layout's h1, at the Section size, nothing under it (HON-960).
    it('renders the section as an h2 at the Section size, with no h3', () => {
      renderForm()

      const heading = screen.getByRole('heading', { name: 'Meals to plan', level: 2 })
      expect(heading).toHaveClass('text-base', 'font-semibold')
      expect(heading).not.toHaveClass('uppercase')
      expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0)
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
    // The Meal preferences page shows a member the notice once, above the forms.
    it('leaves the owner-only message to the page for non-owners', () => {
      renderForm({ isOwner: false })

      expect(screen.queryByText(OWNER_ONLY_NOTICE)).not.toBeInTheDocument()
    })

    // The preferences PATCH is owner-only and 403s a member (HON-677).
    it('disables every meal checkbox for non-owners', () => {
      renderForm({ isOwner: false })

      const checkboxes = screen.getAllByRole('checkbox')
      expect(checkboxes).toHaveLength(6)
      for (const checkbox of checkboxes) {
        expect(checkbox).toBeDisabled()
      }
    })

    it('enables the meal checkboxes for owners', () => {
      renderForm({ isOwner: true })

      expect(screen.getByLabelText('Weekdays: Dinner')).not.toBeDisabled()
    })

    it('never shows a save button to non-owners', () => {
      renderForm({ isOwner: false })

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })
  })

  describe('initial values from preferences', () => {
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

  describe('save button visibility', () => {
    it('shows no save button at rest', () => {
      renderForm()

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
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

  describe('after a failed save', () => {
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

    // No button to press, so submit the form element directly (HON-677).
    it('does not send any request when a non-owner submits', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm({ isOwner: false })

      fireEvent.submit(section('Meals to plan'))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockFetch).not.toHaveBeenCalled()
      expect(mockRouterRefresh).not.toHaveBeenCalled()
    })

    // An Estonian household must never read the route's English `error`
    // (HON-914), so this renders the real `et` catalog.
    describe('in Estonian', () => {
      const et = etMessages.household.settings

      it('shows the Estonian owner-only notice for a 403', async () => {
        mockFetch.mockResolvedValue(fail(403, 'Only household owners can update preferences'))
        renderForm({}, 'et')

        await userEvent.click(
          screen.getByLabelText(`${et.weekdaysRow}: ${etMessages.enums.MealType.lunch}`),
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
    it('plans dinner on both day groups when there are no preferences', () => {
      renderForm({ preferences: null })

      expect(screen.getByLabelText('Weekdays: Dinner')).toBeChecked()
      expect(screen.getByLabelText('Weekends: Dinner')).toBeChecked()
    })
  })

  // Each section is its own form, and its Save button shows only while the
  // section differs from what was saved (HON-961).
  describe('below Food preferences, as on the Meal preferences tab', () => {
    it('renders Food preferences, then Meals to plan', () => {
      renderTab()

      expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual([
        'Food preferences',
        'Meals to plan',
      ])
    })

    it('shows one save button, in the changed section only', async () => {
      renderTab()

      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))

      expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1)
      expect(within(section('Food preferences')).getByRole('button', { name: 'Save' })).toBe(
        screen.getByRole('button', { name: 'Save' }),
      )
    })

    it('shows a save button in each section that has a change', async () => {
      renderTab()

      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))
      await userEvent.click(screen.getByLabelText('Weekdays: Lunch'))

      expect(
        within(section('Food preferences')).getByRole('button', { name: 'Save' }),
      ).toBeInTheDocument()
      expect(
        within(section('Meals to plan')).getByRole('button', { name: 'Save' }),
      ).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(2)
    })

    it('leaves focus alone when the user has moved to another section', async () => {
      const respond = deferFetch()
      renderTab()

      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      const weekdayLunch = screen.getByLabelText('Weekdays: Lunch')
      act(() => weekdayLunch.focus())
      respond(ok())

      await waitFor(() => expect(toast.success).toHaveBeenCalled())
      expect(weekdayLunch).toHaveFocus()
    })

    it('shows the saving state while the request is pending', async () => {
      deferFetch()
      renderTab()

      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Gluten' })).toBeDisabled()
      // The other section stays editable.
      expect(screen.getByLabelText('Weekdays: Lunch')).not.toBeDisabled()
    })

    it('leaves focus alone on a failure when the user has moved to another section', async () => {
      const respond = deferFetch()
      renderTab()

      await userEvent.click(screen.getByRole('button', { name: 'Gluten' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      const weekdayLunch = screen.getByLabelText('Weekdays: Lunch')
      act(() => weekdayLunch.focus())
      respond(fail(500, 'Failed to update household preferences'))

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
      expect(weekdayLunch).toHaveFocus()
    })

    // No button to press, so submit each form element directly (HON-677).
    it('sends nothing when a non-owner submits either section', async () => {
      mockFetch.mockResolvedValue(ok())
      renderTab({ isOwner: false })

      for (const form of screen.getAllByRole('form')) fireEvent.submit(form)
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockFetch).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})
