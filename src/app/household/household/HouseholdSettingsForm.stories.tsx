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
          'Household settings form. Locale selector is gated: only locales in `PUBLIC_LOCALES` are offered. A household whose persisted locale is outside that list (e.g. via a direct DB write during partner testing) still renders its current locale as a disabled option.',
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
          'Standard household on the public default locale. The locale selector should offer only English.',
      },
    },
  },
}

export const EstonianHouseholdCurrent: Story = {
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
          'Household whose persisted `locale` falls outside `PUBLIC_LOCALES` — reached via a direct DB write, or `Accept-Language` auto-resolution at onboarding when `et` was still public. The selector preserves the current state by rendering Estonian as a disabled option; English remains the only selectable value.',
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
