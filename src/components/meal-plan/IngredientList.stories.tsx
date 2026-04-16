import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { IngredientList } from './IngredientList'
import type { MealComponent, PantryIngredient } from './types'

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
  {
    ingredientId: 'salt',
    quantityPerServing: 1,
    isVague: true,
    originalPhrase: 'to taste',
    ingredient: {
      id: 'salt',
      name: 'Salt',
      category: 'pantry',
      defaultUnit: 'g',
      gramsPerPiece: null,
    },
  },
]

const meta = {
  title: 'Meal plan/IngredientList',
  component: IngredientList,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    components,
    servings: 4,
    householdSize: 4,
  },
  decorators: [
    (Story) => (
      <div className="max-w-md rounded-lg border p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof IngredientList>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Compact: Story = {
  args: { compact: true },
}

export const WithPantryAvailability: Story = {
  args: {
    pantryIngredients: [
      { ingredientId: 'chicken-thigh', isStaple: false },
      { ingredientId: 'garlic', isStaple: true },
      { ingredientId: 'olive-oil', isStaple: true },
      { ingredientId: 'salt', isStaple: true },
    ] satisfies PantryIngredient[],
  },
}

export const WithCheckboxes: Story = {
  args: {
    pantryIngredients: [
      { ingredientId: 'chicken-thigh', isStaple: false },
      { ingredientId: 'garlic', isStaple: true },
      { ingredientId: 'olive-oil', isStaple: true },
    ] satisfies PantryIngredient[],
    onToggleAvailability: fn(),
  },
}

export const WithAvailabilityBadge: Story = {
  args: {
    availability: {
      isReady: false,
      missingCount: 2,
      missingIngredients: ['Potato', 'Lemon'],
    },
    pantryIngredients: [
      { ingredientId: 'chicken-thigh', isStaple: false },
      { ingredientId: 'garlic', isStaple: true },
    ] satisfies PantryIngredient[],
  },
}

export const HideAvailability: Story = {
  args: {
    pantryIngredients: [
      { ingredientId: 'chicken-thigh', isStaple: false },
      { ingredientId: 'garlic', isStaple: true },
    ] satisfies PantryIngredient[],
    hideAvailability: true,
  },
}

export const LargerServings: Story = {
  args: { servings: 8, householdSize: 4 },
}
