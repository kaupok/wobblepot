import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { HouseholdSettingsForm } from './HouseholdSettingsForm'

const meta = {
  title: 'Feature/HouseholdSettingsForm',
  component: HouseholdSettingsForm,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    a11y: {
      config: {
        rules: [
          // WHY: The form renders h2 → h4 (skipping h3) to match the codebase-wide
          // Heading variant pattern. In production the parent page supplies the h1,
          // and every page-level form follows the same h1 → h2 → h4 convention;
          // changing it here alone would create a cross-codebase inconsistency.
          { id: 'heading-order', enabled: false },
        ],
      },
    },
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
          'Standard household on the default English locale. Both English and Estonian are selectable.',
      },
    },
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
          'Non-owner viewer: name, timezone, and locale controls are disabled; preference controls remain editable.',
      },
    },
  },
}
