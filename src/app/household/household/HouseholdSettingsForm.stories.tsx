import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { HouseholdSettingsForm } from './HouseholdSettingsForm'

const meta = {
  title: 'Feature/HouseholdSettingsForm',
  component: HouseholdSettingsForm,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Household settings form. Locale selector exposes every locale in `PUBLIC_LOCALES` — currently English and Estonian.',
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
  },
  parameters: {
    docs: {
      description: {
        story:
          'Household with allergens ticked. The AI-processing notice under the allergen group is the DPIA point-of-entry affirmation (HON-666) and describes the group via `aria-describedby`.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = canvas.getByRole('group', { name: 'Allergens to avoid' })
    await expect(group).toHaveAccessibleDescription(/sent to our AI provider/)
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
  },
  parameters: {
    docs: {
      description: {
        story:
          'Non-owner viewer: every control is disabled, one owner-only notice sits under the form description, and there is no save button. Both settings endpoints are owner-only (HON-677).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(
        'Only the household owner can change these settings. You can see them here.',
      ),
    ).toBeInTheDocument()
    await expect(canvas.getByLabelText('Household name')).toBeDisabled()
    await expect(canvas.getByLabelText('Gluten')).toBeDisabled()
    await expect(canvas.getByLabelText('Vegan')).toBeDisabled()
    await expect(canvas.getByLabelText('Dietary restrictions')).toBeDisabled()
    await expect(canvas.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument()
  },
}
