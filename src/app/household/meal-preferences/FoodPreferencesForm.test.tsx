import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toast } from 'sonner'
import { FoodPreferencesForm } from './FoodPreferencesForm'
import { dropFocusToBody } from '@/test/focus'
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

// The global next-intl mock has no `t.rich`, which the allergen notice needs.
// `renderSettings` wraps in a real provider with the English catalogue.
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

type Props = Parameters<typeof FoodPreferencesForm>[0]

function renderForm(overrides: Partial<Props> = {}) {
  return renderSettings(
    <FoodPreferencesForm preferences={defaultPreferences} isOwner {...overrides} />,
  )
}

/**
 * Household → Meal preferences (HON-1257): the Food preferences cases of the
 * old `HouseholdSettingsForm.test.tsx`. The cases that need both sections of
 * the tab are in `MealsToPlanForm.test.tsx`.
 */
describe('FoodPreferencesForm', () => {
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

      const heading = screen.getByRole('heading', { name: 'Food preferences', level: 2 })
      expect(heading).toHaveClass('text-base', 'font-semibold')
      expect(heading).not.toHaveClass('uppercase')
      expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0)
    })

    it('puts both tag inputs under Food preferences', () => {
      renderForm()

      const food = screen.getByRole('heading', { name: 'Food preferences' }).closest('section')!
      expect(within(food).getByLabelText('Dietary restrictions (optional)')).toBeInTheDocument()
      expect(within(food).getByLabelText('Ingredients to avoid (optional)')).toBeInTheDocument()
    })

    // The DPIA's allergen notice (HON-666) is the only helper copy; the tag
    // inputs' placeholders carry their examples.
    it('renders only the allergen helper line', () => {
      const { container } = renderForm()

      const helpers = Array.from(container.querySelectorAll('p.text-muted-foreground')).map(
        (p) => p.textContent,
      )
      expect(helpers).toEqual([expect.stringContaining('Allergens you tick here')])
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
  })

  describe('owner vs member permissions', () => {
    // The Meal preferences page shows a member the notice once, above the forms.
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
      expect(screen.getByLabelText('Dietary restrictions (optional)')).toBeDisabled()
      expect(screen.getByLabelText('Ingredients to avoid (optional)')).toBeDisabled()
    })

    it('enables preferences for owners', () => {
      renderForm({ isOwner: true })

      expect(screen.getByRole('button', { name: 'Gluten' })).not.toBeDisabled()
      expect(screen.getByRole('radio', { name: 'Vegan' })).not.toBeDisabled()
    })

    it('never shows a save button to non-owners', () => {
      renderForm({ isOwner: false })

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })
  })

  describe('initial values from preferences', () => {
    it('shows selected dietary type', () => {
      renderForm({ preferences: { ...defaultPreferences, dietaryType: 'vegetarian' } })

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
  })

  describe('form interactions', () => {
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
  })

  // The Save button shows only while the section differs from what was saved
  // (HON-961).
  describe('save button visibility', () => {
    it('shows no save button at rest', () => {
      renderForm()

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
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

    // HON-1126: the route counts the planned meals the new preferences break.
    it('says how many planned meals conflict with the saved preferences', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ conflictingEntries: 2 }),
      })
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Tree nuts' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          'Settings saved. 2 planned meals conflict with them. They are marked on Today.',
        ),
      )
    })

    it('says only "Settings saved" when no planned meal conflicts', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ conflictingEntries: 0 }),
      })
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Tree nuts' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Settings saved'))
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
  })

  describe('after a failed save', () => {
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

    // No button to press, so submit the form element directly: the section
    // itself must refuse, not just the missing button (HON-677).
    it('does not send any request when a non-owner submits', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm({ isOwner: false })

      fireEvent.submit(section('Food preferences'))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockFetch).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
      expect(mockRouterRefresh).not.toHaveBeenCalled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('null preferences handling', () => {
    it('handles null preferences gracefully', () => {
      renderForm({ preferences: null })

      expect(screen.getByRole('radio', { name: 'No preference' })).toBeChecked()
      for (const toggle of within(
        screen.getByRole('group', { name: 'Allergens to avoid' }),
      ).getAllByRole('button')) {
        expect(toggle).toHaveAttribute('aria-pressed', 'false')
      }
    })
  })
})
