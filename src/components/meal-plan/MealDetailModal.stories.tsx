import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { MealDetailModal } from './MealDetailModal'
import type { MealComponent, MealData, PantryIngredient } from './types'

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
  {
    ingredientId: 'olive-oil',
    quantityPerServing: 15,
    ingredient: {
      id: 'olive-oil',
      name: 'Olive oil',
      category: 'pantry',
      defaultUnit: 'g',
      gramsPerPiece: null,
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
  { ingredientId: 'olive-oil', isStaple: true },
]

const meta = {
  title: 'Meal plan/MealDetailModal',
  component: MealDetailModal,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Wraps MealDetail in a Dialog — portal-based. Use the theme toolbar to verify dark mode styles the overlay + content correctly.',
      },
    },
  },
  args: {
    meal: baseMeal,
    householdSize: 4,
    open: true,
    onOpenChange: fn(),
    planId: 'plan-1',
    entryId: 'entry-1',
    pantryIngredients,
  },
} satisfies Meta<typeof MealDetailModal>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {}

export const WithNote: Story = {
  args: {
    note: 'Kids loved this — double the garlic next time.',
    onNoteChange: fn(),
  },
}

export const WithServingOverride: Story = {
  args: {
    servingOverride: 6,
    onServingOverrideChange: fn(),
  },
}

export const WithPreparationNotes: Story = {
  args: {
    meal: {
      ...baseMeal,
      preparationNotes:
        'Broil last 2 minutes for crispier skin. Serve with steamed green beans and flaky salt.',
    },
  },
}
