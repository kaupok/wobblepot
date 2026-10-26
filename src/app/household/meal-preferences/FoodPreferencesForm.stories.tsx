import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { Toaster } from 'sonner'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { FoodPreferencesForm } from './FoodPreferencesForm'
import { MealsToPlanForm } from './MealsToPlanForm'

const meta = {
  title: 'Feature/Household/FoodPreferencesForm',
  component: FoodPreferencesForm,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Household → Meal preferences (HON-1257): the Food preferences section, a Section-level h2 and its own form (HON-960, HON-961): dietary type, allergens, notes for the AI and ingredients to avoid. The Save button shows only while a field differs from the saved value, and saves only these four fields.',
      },
    },
  },
  args: {
    preferences: {
      dietaryType: null,
      allergensToAvoid: [],
      restrictions: [],
      excludedIngredients: [],
      weekdayMealTypes: ['dinner'],
      weekendMealTypes: ['dinner'],
    },
    excludedMatches: [],
    isOwner: true,
  },
} satisfies Meta<typeof FoodPreferencesForm>

export default meta
type Story = StoryObj<typeof meta>

// The body of the last PATCH the route received, for the payload assertions.
let lastPreferencesBody: unknown

// A section's submit button, in either state. While the save is in flight it
// reads "Saving…", so waiting only for "Save" to go passes mid-request, before
// the response moves focus to the heading (HON-1140). Once neither name is on
// screen the save has settled: SettingsSection focuses the heading in the same
// `onSuccess` that marks the section clean and unmounts the button.
const SAVE_BUTTON = /^(Save|Saving…)$/

const saveHandlers = [
  http.patch('/api/households/me/preferences', async ({ request }) => {
    lastPreferencesBody = await request.json()
    return HttpResponse.json({})
  }),
]

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('radio', { name: 'No preference' })).toBeChecked()
    await expect(canvas.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  },
}

export const AllergensSelected: Story = {
  args: {
    preferences: {
      dietaryType: null,
      allergensToAvoid: ['gluten', 'peanuts'],
      restrictions: [],
      excludedIngredients: [],
      weekdayMealTypes: ['dinner'],
      weekendMealTypes: ['dinner'],
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          'Household with allergens ticked. Each allergen is a toggle chip; a pressed chip is filled and shows a check icon, so the state is not carried by colour alone (HON-962). The AI-processing notice under the allergen group is the DPIA point-of-entry affirmation (HON-666) and describes the group via `aria-describedby`.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = canvas.getByRole('group', { name: 'Allergens to avoid' })
    await expect(group).toHaveAccessibleDescription(/sent to our AI provider/)
    const gluten = within(group).getByRole('button', { name: 'Gluten' })
    const eggs = within(group).getByRole('button', { name: 'Eggs' })
    await expect(gluten).toHaveAttribute('aria-pressed', 'true')
    await expect(eggs).toHaveAttribute('aria-pressed', 'false')
    // The check icon renders only on a pressed chip.
    await expect(gluten.querySelector('[data-slot="toggle-indicator"]')).toBeVisible()
    await expect(eggs.querySelector('[data-slot="toggle-indicator"]')).not.toBeVisible()
    await expect(canvas.getByRole('link', { name: 'privacy policy' })).toHaveAttribute(
      'href',
      '/privacy',
    )
  },
}

export const NonOwner: Story = {
  args: { isOwner: false },
  parameters: {
    docs: {
      description: {
        story:
          "Non-owner viewer: every control is disabled and there is no save button. The route is owner-only (HON-677); the owner-only notice is the Meal preferences page's, above the forms (HON-960).",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Gluten' })).toBeDisabled()
    await expect(canvas.getByRole('radio', { name: 'Vegan' })).toBeDisabled()
    await expect(canvas.getByLabelText('Notes for the AI (optional)')).toBeDisabled()
    await expect(canvas.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  },
}

export const DietaryTypeDirty: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Vegan picked in the Dietary type chips: one chip is always checked, and the section shows its Save button (HON-962).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = canvas.getByRole('radiogroup', { name: 'Dietary type' })
    await expect(within(group).getByRole('radio', { name: 'No preference' })).toBeChecked()

    await userEvent.click(within(group).getByRole('radio', { name: 'Vegan' }))
    await expect(within(group).getByRole('radio', { name: 'Vegan' })).toBeChecked()
    await expect(within(group).getByRole('radio', { name: 'No preference' })).not.toBeChecked()
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeVisible()
  },
}

export const Dirty: Story = {
  parameters: {
    msw: { handlers: saveHandlers },
    docs: {
      description: {
        story:
          'Ticking an allergen shows the Save button. Saving sends only the four food fields to the preferences route, so the meal types are left as they are; the button then goes and focus moves to the section heading (HON-961).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    lastPreferencesBody = undefined
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()

    await userEvent.click(canvas.getByRole('button', { name: 'Gluten' }))
    const save = canvas.getByRole('button', { name: 'Save' })
    await expect(save).toBeVisible()

    await userEvent.click(save)
    await waitFor(() =>
      expect(lastPreferencesBody).toEqual({
        dietaryType: null,
        allergensToAvoid: ['gluten'],
        restrictions: [],
        excludedIngredients: [],
      }),
    )
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: SAVE_BUTTON })).not.toBeInTheDocument(),
    )
    await expect(canvas.getByRole('heading', { name: 'Food preferences' })).toHaveFocus()
  },
}

export const SavedWithConflicts: Story = {
  // The app's toaster sits in the root layout, not in the section.
  decorators: [
    (Story) => (
      <>
        <Story />
        <Toaster />
      </>
    ),
  ],
  parameters: {
    msw: {
      handlers: [
        http.patch('/api/households/me/preferences', () =>
          HttpResponse.json({ allergensToAvoid: ['nuts'], conflictingEntries: 2 }),
        ),
      ],
    },
    docs: {
      description: {
        story:
          'Tree nuts ticked and saved while two planned meals contain nuts: the route counts them, and the toast says so and where they are marked, instead of only "Settings saved". The save changes no meal (HON-1126).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Tree nuts' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    const toast = await within(document.body).findByText(
      'Settings saved. 2 planned meals conflict with them. They are marked on Today.',
    )
    // Sonner fades the toast in.
    await waitFor(() => expect(toast).toBeVisible())
  },
}

/**
 * Both sections of the Meal preferences tab, as the page renders them, with
 * one change in Meals to plan: one Save button, at the end of that section,
 * and none in Food preferences. Saving it sends only the meal types.
 */
export const TabOneSectionChanged: Story = {
  render: (args) => (
    <div className="flex flex-col gap-10">
      <FoodPreferencesForm {...args} />
      <MealsToPlanForm {...args} />
    </div>
  ),
  parameters: { msw: { handlers: saveHandlers } },
  play: async ({ canvasElement }) => {
    lastPreferencesBody = undefined
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText('Weekends: Lunch'))

    const buttons = canvas.getAllByRole('button', { name: 'Save' })
    await expect(buttons).toHaveLength(1)
    const meals = canvas.getByRole('form', { name: 'Meals to plan' })
    await expect(within(meals).getByRole('button', { name: 'Save' })).toBe(buttons[0])

    await userEvent.click(buttons[0]!)
    await waitFor(() =>
      expect(lastPreferencesBody).toEqual({
        weekdayMealTypes: ['dinner'],
        weekendMealTypes: ['dinner', 'lunch'],
      }),
    )
  },
}

export const Phone: Story = {
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story:
          'Phone width with a change: "Save" fills the column. Every dietary chip and allergen toggle is at least 44px tall, and the chip rows wrap inside the column (HON-962).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const chips = [
      ...within(canvas.getByRole('radiogroup', { name: 'Dietary type' })).getAllByRole('radio'),
      ...within(canvas.getByRole('group', { name: 'Allergens to avoid' })).getAllByRole('button'),
    ]
    for (const chip of chips) {
      await expect(chip.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
    const food = canvas.getByRole('form', { name: 'Food preferences' })
    await expect(food.scrollWidth).toBeLessThanOrEqual(food.clientWidth)

    await userEvent.click(canvas.getByRole('button', { name: 'Gluten' }))
    const button = canvas.getByRole('button', { name: 'Save' })
    await expect(button.getBoundingClientRect().width).toBe(
      button.parentElement!.getBoundingClientRect().width,
    )
  },
}

/**
 * Estonian at phone width, inside the page's `px-4` gutters: the chip rows
 * wrap, and the AI notes field keeps its Estonian name and help (HON-1326).
 */
export const PhoneEstonian: Story = {
  globals: { viewport: { value: 'mobileIphone', isRotated: false }, locale: 'et' },
  decorators: [
    (Story) => (
      <div className="px-4">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const form = canvas.getByRole('form')
    await expect(form.scrollWidth).toBeLessThanOrEqual(form.clientWidth)
    const notes = canvas.getByLabelText('Märkmed AI-le (vabatahtlik)')
    await expect(notes).toHaveAttribute(
      'placeholder',
      'nt lastele vähem soola. Eelista valgurikkaid toite.',
    )
    await expect(notes).toHaveAccessibleDescription(/^AI järgib neid märkmeid/)
  },
}

/**
 * Long saved notes at phone width (HON-1342): each note is one line of the
 * textarea, and a long sentence wraps inside the field, not past its border.
 */
export const LongNotesPhone: Story = {
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  args: {
    preferences: {
      ...meta.args.preferences,
      restrictions: [
        'Less salt for the kids, and nothing spicier than a mild paprika on weeknights',
        'Favour high-protein dishes',
      ],
    },
  },
  decorators: [
    (Story) => (
      <div className="px-4">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const notes = canvas.getByLabelText('Notes for the AI (optional)')
    await expect(notes).toHaveValue(
      'Less salt for the kids, and nothing spicier than a mild paprika on weeknights\nFavour high-protein dishes',
    )
    await expect(notes.scrollWidth).toBeLessThanOrEqual(notes.clientWidth)
    const form = canvas.getByRole('form')
    await expect(form.scrollWidth).toBeLessThanOrEqual(form.clientWidth)
    await expect(canvas.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  },
}

const tagMatches = {
  preferences: {
    dietaryType: null,
    allergensToAvoid: [],
    restrictions: [],
    excludedIngredients: ['mushrooms', 'dragonfruit'],
    weekdayMealTypes: ['dinner' as const],
    weekendMealTypes: ['dinner' as const],
  },
  excludedMatches: [
    {
      tag: 'mushrooms',
      ingredients: [
        { id: 'ing-1', name: 'chestnut mushroom' },
        { id: 'ing-2', name: 'mushroom' },
        { id: 'ing-3', name: 'shiitake mushroom' },
      ],
    },
    { tag: 'dragonfruit', ingredients: [] },
  ],
}

/**
 * HON-1321: under "Ingredients to avoid", what each saved tag excludes. A tag
 * that matches ingredients names them in a disclosure; one that matches none
 * warns, with an icon, that no meal is excluded.
 */
export const IngredientMatches: Story = {
  args: tagMatches,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'What each ingredient to avoid excludes' })
    await userEvent.click(within(list).getByText('mushrooms: excludes 3 ingredients'))
    await expect(
      within(list).getByText('chestnut mushroom, mushroom, shiitake mushroom'),
    ).toBeVisible()
    await expect(
      within(list).getByText('dragonfruit: matches no ingredient, so no meal is excluded.'),
    ).toBeVisible()
  },
}

/** The same matches in Estonian. */
export const IngredientMatchesEstonian: Story = {
  args: tagMatches,
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Mida iga välditav koostisosa välistab' })
    await expect(within(list).getByText('mushrooms: välistab 3 koostisosa')).toBeVisible()
  },
}
