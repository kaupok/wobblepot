import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { HouseholdSettingsForm } from './HouseholdSettingsForm'
import { HouseholdDetailsForm } from './HouseholdDetailsForm'
import { FoodPreferencesForm } from './FoodPreferencesForm'
import { MealsToPlanForm } from './MealsToPlanForm'
import { WeeklyReminderForm } from './WeeklyReminderForm'

const meta = {
  title: 'Feature/HouseholdSettingsForm',
  component: HouseholdSettingsForm,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Household settings: four sections, each a Section-level h2 (Household details, Food preferences, Meals to plan, Weekly reminder) and its own form (HON-960, HON-961, HON-1084). A section shows its Save button only while one of its fields differs from the saved value, and saves only its own fields. Locale selector exposes every locale in `PUBLIC_LOCALES` — currently English and Estonian.',
      },
    },
  },
} satisfies Meta<typeof HouseholdSettingsForm>

export default meta
type Story = StoryObj<typeof meta>

const basePreferences = {
  dietaryType: null,
  allergensToAvoid: [],
  restrictions: [],
  excludedIngredients: [],
  weekdayMealTypes: ['dinner'] as const,
  weekendMealTypes: ['dinner'] as const,
}

export const Default: Story = {
  args: {
    household: {
      id: 'household-default',
      name: 'Test household',
      timezone: 'Europe/Tallinn',
      locale: 'en',
    },
    preferences: {
      ...basePreferences,
      weekdayMealTypes: [...basePreferences.weekdayMealTypes],
      weekendMealTypes: [...basePreferences.weekendMealTypes],
    },
    isOwner: true,
    reminderWeekday: null,
    reminderConfirmed: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Standard household on the default English locale. Both English and Estonian are selectable. The play function checks that both select triggers carry their value text from the first render, not only after Radix mounts the options (HON-761).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // At rest there is nothing to save (HON-961).
    await expect(canvas.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    // No waitFor: the value text must be there synchronously, not only after
    // Radix mirrors it from the mounted items (HON-761).
    await expect(canvas.getByRole('combobox', { name: /timezone/i })).toHaveTextContent(
      'Europe/Tallinn',
    )
    await expect(canvas.getByRole('combobox', { name: 'Language' })).toHaveTextContent('English')
  },
}

export const EstonianHousehold: Story = {
  args: {
    household: {
      id: 'household-et',
      name: 'Partner household',
      timezone: 'Europe/Tallinn',
      locale: 'et',
    },
    preferences: {
      ...basePreferences,
      weekdayMealTypes: [...basePreferences.weekdayMealTypes],
      weekendMealTypes: [...basePreferences.weekendMealTypes],
    },
    isOwner: true,
    reminderWeekday: null,
    reminderConfirmed: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Household whose persisted `locale` is Estonian — selector trigger reflects the current value and both options remain selectable.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('combobox', { name: 'Language' })).toHaveTextContent('Estonian')
  },
}

export const AllergensSelected: Story = {
  args: {
    household: {
      id: 'household-allergens',
      name: 'Test household',
      timezone: 'Europe/Tallinn',
      locale: 'en',
    },
    preferences: {
      ...basePreferences,
      allergensToAvoid: ['gluten', 'peanuts'],
      weekdayMealTypes: [...basePreferences.weekdayMealTypes],
      weekendMealTypes: [...basePreferences.weekendMealTypes],
    },
    isOwner: true,
    reminderWeekday: null,
    reminderConfirmed: true,
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
  args: {
    household: {
      id: 'household-member',
      name: 'Partner household',
      timezone: 'Europe/Tallinn',
      locale: 'en',
    },
    preferences: {
      ...basePreferences,
      weekdayMealTypes: [...basePreferences.weekdayMealTypes],
      weekendMealTypes: [...basePreferences.weekendMealTypes],
    },
    isOwner: false,
    reminderWeekday: null,
    reminderConfirmed: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Non-owner viewer: every household control is disabled and there is no save button. Both settings endpoints are owner-only (HON-677); the owner-only notice is the page's, under its title (HON-960). The Weekly reminder is the viewer's own setting, so it stays editable and says so (HON-1084).",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Household name')).toBeDisabled()
    await expect(canvas.getByRole('button', { name: 'Gluten' })).toBeDisabled()
    await expect(canvas.getByRole('radio', { name: 'Vegan' })).toBeDisabled()
    await expect(canvas.getByLabelText('Dietary restrictions (optional)')).toBeDisabled()
    await expect(canvas.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    const reminder = canvas.getByRole('form', { name: 'Weekly reminder' })
    await expect(
      within(reminder).getByText('This setting is your own, so you can change it.'),
    ).toBeVisible()
    await expect(
      within(reminder).getByRole('checkbox', { name: 'Remind me to plan next week' }),
    ).toBeEnabled()
  },
}

// The body of the last PATCH each route received, for the payload assertions.
let lastHouseholdBody: unknown
let lastPreferencesBody: unknown
let lastReminderBody: unknown

const saveHandlers = [
  http.patch('/api/households/me', async ({ request }) => {
    lastHouseholdBody = await request.json()
    return HttpResponse.json({})
  }),
  http.patch('/api/households/me/preferences', async ({ request }) => {
    lastPreferencesBody = await request.json()
    return HttpResponse.json({})
  }),
  http.patch('/api/households/me/members/me/reminder', async ({ request }) => {
    lastReminderBody = await request.json()
    return HttpResponse.json({})
  }),
]

export const HouseholdDetails: Story = {
  args: Default.args,
  render: (args) => <HouseholdDetailsForm household={args.household} isOwner={args.isOwner} />,
  parameters: {
    docs: {
      description: {
        story: 'The Household details section on its own: name, timezone and language.',
      },
    },
  },
}

export const HouseholdDetailsDirty: Story = {
  ...HouseholdDetails,
  parameters: {
    docs: {
      description: {
        story: 'A changed household name: the section shows its Save button.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Household name'), ' and friends')
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeVisible()
  },
}

export const FoodPreferences: Story = {
  args: Default.args,
  render: (args) => <FoodPreferencesForm preferences={args.preferences} isOwner={args.isOwner} />,
  parameters: {
    docs: {
      description: {
        story:
          'The Food preferences section on its own: dietary type, allergens, restrictions and ingredients to avoid.',
      },
    },
  },
}

export const DietaryTypeDirty: Story = {
  ...FoodPreferences,
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

export const FoodPreferencesDirty: Story = {
  ...FoodPreferences,
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
      expect(canvas.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(),
    )
    await expect(canvas.getByRole('heading', { name: 'Food preferences' })).toHaveFocus()
  },
}

export const MealsToPlan: Story = {
  args: Default.args,
  render: (args) => <MealsToPlanForm preferences={args.preferences} isOwner={args.isOwner} />,
  parameters: {
    docs: {
      description: {
        story:
          'The Meals to plan section on its own: one grid with the meals as columns and Weekdays / Weekends as rows (HON-962).',
      },
    },
  },
}

export const MealsToPlanDirty: Story = {
  ...MealsToPlan,
  parameters: {
    docs: {
      description: {
        story:
          'Lunch added to the weekend: the section shows its Save button. Each checkbox names both axes ("Weekends: Lunch").',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const table = canvas.getByRole('table', { name: 'Meals to plan' })
    const weekendLunch = within(table).getByRole('checkbox', { name: 'Weekends: Lunch' })
    await userEvent.click(weekendLunch)
    await expect(weekendLunch).toBeChecked()
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeVisible()
  },
}

export const WeeklyReminderOff: Story = {
  args: Default.args,
  render: (args) => (
    <WeeklyReminderForm
      weekday={args.reminderWeekday}
      confirmed={args.reminderConfirmed}
      isOwner={args.isOwner}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The Weekly reminder section, switched off: one checkbox and the line that says what the email does. The weekday select shows only while it is on (HON-1084).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole('checkbox', { name: 'Remind me to plan next week' })
    await expect(toggle).not.toBeChecked()
    await expect(toggle).toHaveAccessibleDescription(/only when next week has no meals planned/)
    await expect(canvas.queryByRole('combobox')).not.toBeInTheDocument()
  },
}

export const WeeklyReminderOn: Story = {
  args: { ...Default.args, reminderWeekday: 3 },
  render: WeeklyReminderOff.render,
  parameters: {
    docs: {
      description: {
        story:
          'Switched on for Wednesday. The weekday names come from `Intl` in the household language, not the catalog.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('checkbox', { name: 'Remind me to plan next week' }),
    ).toBeChecked()
    await expect(canvas.getByRole('combobox', { name: 'Day' })).toHaveTextContent('Wednesday')
    await expect(canvas.queryByText(/We emailed you a link/)).not.toBeInTheDocument()
  },
}

export const WeeklyReminderAwaitingConfirm: Story = {
  args: { ...Default.args, reminderWeekday: 7, reminderConfirmed: false },
  render: WeeklyReminderOff.render,
  parameters: {
    docs: {
      description: {
        story:
          'Switched on, but the confirm link in the email is not opened yet: a muted line under the helper says the reminder starts after it is opened, and the checkbox carries it in its description (HON-1113).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const line = 'We emailed you a link. The reminder starts after you open it.'
    await expect(canvas.getByText(line)).toBeVisible()
    await expect(
      canvas.getByRole('checkbox', { name: 'Remind me to plan next week' }),
    ).toHaveAccessibleDescription(/We emailed you a link/)
  },
}

export const WeeklyReminderSwitchOn: Story = {
  ...WeeklyReminderOff,
  parameters: {
    msw: { handlers: saveHandlers },
    docs: {
      description: {
        story:
          'Ticking the checkbox picks Sunday and shows the Save button. Saving sends `{ weekday: 7 }` to the member route, and focus moves to the section heading.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    lastReminderBody = undefined
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Remind me to plan next week' }))
    await expect(canvas.getByRole('combobox', { name: 'Day' })).toHaveTextContent('Sunday')

    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(lastReminderBody).toEqual({ weekday: 7 }))
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(),
    )
    await expect(canvas.getByRole('heading', { name: 'Weekly reminder' })).toHaveFocus()
  },
}

export const OneSectionChanged: Story = {
  args: Default.args,
  parameters: {
    msw: { handlers: saveHandlers },
    docs: {
      description: {
        story:
          'The whole settings column with one change in Household details: one Save button, at the end of that section, and none in the other three. Saving it sends only the household fields.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    lastHouseholdBody = undefined
    lastPreferencesBody = undefined
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Household name'), '!')

    const buttons = canvas.getAllByRole('button', { name: 'Save' })
    await expect(buttons).toHaveLength(1)
    const details = canvas.getByRole('form', { name: 'Household details' })
    await expect(within(details).getByRole('button', { name: 'Save' })).toBe(buttons[0])

    await userEvent.click(buttons[0]!)
    await waitFor(() =>
      expect(lastHouseholdBody).toEqual({
        name: 'Test household!',
        timezone: 'Europe/Tallinn',
        locale: 'en',
      }),
    )
    await expect(lastPreferencesBody).toBeUndefined()
  },
}

export const Desktop: Story = {
  args: Default.args,
  globals: { viewport: { value: 'desktop', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story:
          'Desktop width with a change in Meals to plan. "Save" is as wide as its label and starts at the column edge; on a phone it fills the column (HON-782).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText('Weekdays: Lunch'))
    const button = canvas.getByRole('button', { name: 'Save' })
    await expect(button.getBoundingClientRect().width).toBeLessThan(
      button.parentElement!.getBoundingClientRect().width,
    )
  },
}

export const Phone: Story = {
  args: Default.args,
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story:
          'Phone width with a change in Meals to plan: "Save" fills the column. Every dietary chip and allergen toggle is at least 44px tall, and the chip rows wrap inside the column (HON-962).',
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
    const grid = canvasElement.querySelector<HTMLElement>('[data-slot="table-container"]')!
    await expect(grid.scrollWidth).toBeLessThanOrEqual(grid.clientWidth)

    await userEvent.click(canvas.getByLabelText('Weekdays: Lunch'))
    const button = canvas.getByRole('button', { name: 'Save' })
    await expect(button.getBoundingClientRect().width).toBe(
      button.parentElement!.getBoundingClientRect().width,
    )
  },
}

/**
 * Estonian at phone width, inside the page's `px-4` gutters. The Estonian meal
 * heads are the widest single words in the grid, so below `sm` each row head
 * sits on its own row above its checkboxes, and Dinner stays in view (HON-962).
 */
export const PhoneEstonian: Story = {
  args: Default.args,
  globals: { viewport: { value: 'mobileIphone', isRotated: false }, locale: 'et' },
  render: (args) => (
    <div className="px-4">
      <HouseholdSettingsForm {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const table = canvas.getByRole('table', { name: 'Planeeritavad toidud' })
    const grid = table.parentElement!
    await expect(grid.scrollWidth).toBeLessThanOrEqual(grid.clientWidth)
    // One visible row head per day group, above its checkboxes.
    await expect(within(table).getAllByRole('rowheader')).toEqual([
      within(table).getByRole('rowheader', { name: 'Argipäevad' }),
      within(table).getByRole('rowheader', { name: 'Nädalavahetus' }),
    ])
    const dinner = within(table).getByRole('checkbox', { name: 'Nädalavahetus: Õhtusöök' })
    await expect(dinner.getBoundingClientRect().right).toBeLessThanOrEqual(
      grid.getBoundingClientRect().right,
    )
    for (const form of canvas.getAllByRole('form')) {
      await expect(form.scrollWidth).toBeLessThanOrEqual(form.clientWidth)
    }
  },
}
