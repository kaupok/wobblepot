import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { MealType } from '@/generated/prisma/enums'
import { MealCard } from './MealCard'
import type { MealComponent, MealData, PantryIngredient, PantryItemFull } from './types'

const components: MealComponent[] = [
  {
    ingredientId: 'chicken-thigh',
    quantityPerServing: 150,
    ingredient: {
      id: 'chicken-thigh',
      name: 'Chicken thigh',
      category: 'protein',
      defaultUnit: 'g',
      gramsPerPiece: null,
    },
  },
  {
    ingredientId: 'potato',
    quantityPerServing: 200,
    ingredient: {
      id: 'potato',
      name: 'Potato',
      category: 'produce',
      defaultUnit: 'g',
      gramsPerPiece: null,
    },
  },
  {
    ingredientId: 'lemon',
    quantityPerServing: 0.5,
    ingredient: {
      id: 'lemon',
      name: 'Lemon',
      category: 'produce',
      defaultUnit: 'piece',
      gramsPerPiece: 60,
    },
  },
  {
    ingredientId: 'garlic',
    quantityPerServing: 2,
    ingredient: {
      id: 'garlic',
      name: 'Garlic',
      category: 'aromatic',
      defaultUnit: 'piece',
      gramsPerPiece: 5,
    },
  },
]

const baseMeal: MealData = {
  id: 'meal-1',
  name: 'Lemon-garlic roast chicken',
  kidFriendly: true,
  timeMinutes: 45,
  preparationNotes: null,
  components,
  nutrition: { calories: 520, protein: 42, carbs: 30, fat: 28 },
}

const pantryIngredients: PantryIngredient[] = [
  { ingredientId: 'chicken-thigh', isStaple: false },
  { ingredientId: 'garlic', isStaple: true },
]

const pantryItems: PantryItemFull[] = [
  {
    id: 'p-1',
    ingredientId: 'chicken-thigh',
    quantity: 800,
    isStaple: false,
    ingredient: {
      id: 'chicken-thigh',
      name: 'Chicken thigh',
      category: 'protein',
      defaultUnit: 'g',
    },
  },
  {
    id: 'p-2',
    ingredientId: 'garlic',
    quantity: 10,
    isStaple: true,
    ingredient: {
      id: 'garlic',
      name: 'Garlic',
      category: 'aromatic',
      defaultUnit: 'piece',
    },
  },
]

const meta = {
  title: 'Meal plan/MealCard',
  component: MealCard,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    entryId: 'entry-1',
    planId: 'plan-1',
    mealType: MealType.dinner,
    householdSize: 4,
    pantryIngredients,
    pantryItems,
  },
  decorators: [
    (Story) => (
      <div className="max-w-xs">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MealCard>

export default meta
type Story = StoryObj<typeof meta>

export const Planned: Story = {
  args: {
    meal: baseMeal,
    status: 'planned',
  },
}

export const PlannedWithNote: Story = {
  args: {
    meal: baseMeal,
    status: 'planned',
    note: 'Double the garlic — kids approved.',
  },
}

export const WithServingOverride: Story = {
  args: {
    meal: baseMeal,
    status: 'planned',
    servingOverride: 6,
  },
}

export const LowAvailability: Story = {
  args: {
    meal: baseMeal,
    status: 'planned',
    pantryIngredients: [{ ingredientId: 'garlic', isStaple: true }],
  },
  parameters: {
    docs: {
      description: {
        story: 'Most ingredients missing from pantry — shows amber availability indicator.',
      },
    },
  },
}

export const CompletedThumbsUp: Story = {
  args: {
    meal: baseMeal,
    status: 'completed',
    rating: 'up',
  },
}

export const CompletedThumbsDown: Story = {
  args: {
    meal: baseMeal,
    status: 'completed',
    rating: 'down',
  },
}

export const CompletedUnrated: Story = {
  args: {
    meal: baseMeal,
    status: 'completed',
    rating: null,
  },
}

export const Skipped: Story = {
  args: {
    meal: baseMeal,
    status: 'skipped',
  },
}

export const PastCompleted: Story = {
  args: {
    meal: baseMeal,
    status: 'completed',
    rating: 'up',
    isPast: true,
  },
}

export const PastReadonly: Story = {
  args: {
    meal: baseMeal,
    status: 'completed',
    rating: 'up',
    isPast: true,
    isReadOnly: true,
  },
}

export const EmptyPlanned: Story = {
  args: {
    meal: null,
    status: 'planned',
  },
}

export const EmptyWithNote: Story = {
  args: {
    meal: null,
    status: 'planned',
    note: 'Maybe leftovers tonight.',
  },
}

export const EmptyReadonly: Story = {
  args: {
    meal: null,
    status: 'planned',
    isReadOnly: true,
  },
}
