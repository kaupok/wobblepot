import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import { AlternativeCard } from './AlternativeCard'
import type { AlternativeMeal, PantryIngredient } from './types'

const baseMeal: AlternativeMeal = {
  id: 'alt-1',
  name: 'Miso-glazed salmon with rice',
  description: 'Sweet-savoury broiled salmon with ginger rice and pickled cucumber.',
  timeMinutes: 30,
  kidFriendly: true,
  primaryProteinType: 'fish',
  suitableFor: [MealType.dinner],
  reason: 'Balances your week’s protein mix — you’ve had poultry three times already.',
  components: [
    {
      ingredientId: 'salmon-fillet',
      quantityPerServing: 150,
      ingredient: {
        id: 'salmon-fillet',
        name: 'Salmon fillet',
        category: 'protein',
        defaultUnit: 'g',
        gramsPerPiece: null,
      },
    },
    {
      ingredientId: 'short-grain-rice',
      quantityPerServing: 75,
      ingredient: {
        id: 'short-grain-rice',
        name: 'Short-grain rice',
        category: 'grain',
        defaultUnit: 'g',
        gramsPerPiece: null,
      },
    },
    {
      ingredientId: 'miso-paste',
      quantityPerServing: 10,
      ingredient: {
        id: 'miso-paste',
        name: 'White miso',
        category: 'pantry',
        defaultUnit: 'g',
        gramsPerPiece: null,
      },
    },
  ],
  nutrition: { calories: 540, protein: 38, carbs: 55, fat: 18 },
}

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
  args: { meal: baseMeal },
}

export const Selecting: Story = {
  args: { meal: baseMeal, isSelecting: true },
}

export const NotKidFriendly: Story = {
  args: {
    meal: {
      ...baseMeal,
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
      ...baseMeal,
      name: 'Chickpea and spinach curry',
      description: 'Weeknight one-pot curry with tomato, chickpeas and basmati.',
      primaryProteinType: 'legume',
      reason: 'Meatless Monday — aligns with your vegetarian preference.',
    },
  },
}

export const WithPantryAvailability: Story = {
  args: {
    meal: baseMeal,
    pantryIngredients: [
      { ingredientId: 'short-grain-rice', isStaple: true },
      { ingredientId: 'miso-paste', isStaple: true },
    ] satisfies PantryIngredient[],
  },
}
