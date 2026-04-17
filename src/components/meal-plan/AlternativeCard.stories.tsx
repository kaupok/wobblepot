import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { misoSalmonAlternative } from '@/stories/fixtures'
import { AlternativeCard } from './AlternativeCard'
import type { PantryIngredient } from './types'

const mealFixture = misoSalmonAlternative

const meta = {
  title: 'Meal plan/AlternativeCard',
  component: AlternativeCard,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    householdSize: 4,
    onSelect: fn(),
    isSelecting: false,
  },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AlternativeCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { meal: mealFixture },
}

export const Selecting: Story = {
  args: { meal: mealFixture, isSelecting: true },
}

export const NotKidFriendly: Story = {
  args: {
    meal: {
      ...mealFixture,
      name: 'Harissa lamb with pomegranate',
      description: 'Bold, spiced lamb with bright pomegranate seeds and yogurt.',
      kidFriendly: false,
      primaryProteinType: 'lamb',
      reason: 'Something different — you rated this well last month.',
    },
  },
}

export const Vegetarian: Story = {
  args: {
    meal: {
      ...mealFixture,
      name: 'Chickpea and spinach curry',
      description: 'Weeknight one-pot curry with tomato, chickpeas and basmati.',
      primaryProteinType: 'legume',
      reason: 'Meatless Monday — aligns with your vegetarian preference.',
    },
  },
}

export const WithPantryAvailability: Story = {
  args: {
    meal: mealFixture,
    pantryIngredients: [
      { ingredientId: 'short-grain-rice', isStaple: true },
      { ingredientId: 'miso-paste', isStaple: true },
    ] satisfies PantryIngredient[],
  },
}
