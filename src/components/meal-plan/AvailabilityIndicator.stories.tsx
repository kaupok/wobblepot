import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { AvailabilityIndicator } from './AvailabilityIndicator'

const meta = {
  title: 'Meal plan/AvailabilityIndicator',
  component: AvailabilityIndicator,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Pill-shaped badge rendered on meal cards. Shows a green "Have all ingredients" when the meal is ready to cook, otherwise an amber "{n} ingredients missing" count. `missingIngredients` is accepted on the `MealAvailability` shape but not rendered by this component — the detailed list appears elsewhere.',
      },
    },
  },
} satisfies Meta<typeof AvailabilityIndicator>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {
  args: {
    availability: { isReady: true, missingCount: 0, missingIngredients: [] },
  },
}

export const OneMissing: Story = {
  args: {
    availability: {
      isReady: false,
      missingCount: 1,
      missingIngredients: ['Chicken thigh'],
    },
  },
}

export const MultipleMissing: Story = {
  args: {
    availability: {
      isReady: false,
      missingCount: 3,
      missingIngredients: ['Chicken thigh', 'Potato', 'Lemon'],
    },
  },
}
