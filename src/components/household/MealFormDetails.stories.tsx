import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { MealFormDetails } from './MealFormDetails'

const meta = {
  title: 'Feature/Household/MealFormDetails',
  component: MealFormDetails,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Second section of the meal form — meal-type checkboxes (breakfast/lunch/dinner), prep time, and kid-friendly toggle. Controlled inputs only; toggle logic lives in `MealForm`.',
      },
    },
  },
  args: {
    suitableFor: ['dinner'],
    timeMinutes: '45',
    kidFriendly: false,
    disabled: false,
    onMealTypeToggle: fn(),
    onTimeMinutesChange: fn(),
    onKidFriendlyChange: fn(),
  },
} satisfies Meta<typeof MealFormDetails>

export default meta
type Story = StoryObj<typeof meta>

// WHY: Same as MealFormBasicInfo — controlled inputs forward every change to
// the parent. The interesting logic (only-one-meal-type-selectable etc.)
// lives in `MealForm`'s `handleMealTypeToggle`, which has its own coverage.

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Dinner only, 45 min, kid-friendly off — the canonical dinner-recipe starting point.',
      },
    },
  },
}

export const WithAllSelections: Story = {
  args: {
    suitableFor: ['breakfast', 'lunch', 'dinner'],
    timeMinutes: '20',
    kidFriendly: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'All meal types checked, kid-friendly on, 20-minute prep — the maximal selection.',
      },
    },
  },
}

export const Disabled: Story = {
  args: {
    suitableFor: ['lunch', 'dinner'],
    timeMinutes: '30',
    kidFriendly: true,
    disabled: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'All controls disabled — used while the meal mutation is in flight.',
      },
    },
  },
}
