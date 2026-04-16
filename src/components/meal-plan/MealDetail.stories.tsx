import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { MealDetail } from './MealDetail'
import type { MealComponent, MealData, PantryIngredient, StructuredTips } from './types'

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

const tips: StructuredTips = {
  equipment: ['Sheet pan', 'Sharp knife', 'Tongs'],
  steps: [
    'Heat oven to 220°C.',
    'Season chicken with salt, pepper and olive oil.',
    'Arrange on sheet pan with lemon halves and smashed garlic.',
    'Roast 35 min until golden and juices run clear.',
  ],
  pitfalls: ['Don’t crowd the pan.', 'Rest 5 minutes before slicing.'],
  tip: 'Deglaze the pan with a splash of wine to make a quick sauce.',
}

const pantryIngredients: PantryIngredient[] = [
  { ingredientId: 'chicken-thigh', isStaple: false },
  { ingredientId: 'garlic', isStaple: true },
  { ingredientId: 'olive-oil', isStaple: true },
]

const meta = {
  title: 'Meal plan/MealDetail',
  component: MealDetail,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    meal: baseMeal,
    householdSize: 4,
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl rounded-lg border p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MealDetail>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithPantry: Story = {
  args: { pantryIngredients },
}

export const WithServingControl: Story = {
  args: {
    pantryIngredients,
    servings: 4,
    onServingsChange: fn(async () => true),
  },
}

export const TipsCollapsed: Story = {
  args: {
    pantryIngredients,
    onHowToPrepare: fn(),
  },
}

export const TipsExpanded: Story = {
  args: {
    pantryIngredients,
    tips,
    isTipsExpanded: true,
    onHowToPrepare: fn(),
    onHideTips: fn(),
  },
}

export const TipsLoading: Story = {
  args: {
    pantryIngredients,
    isLoadingTips: true,
    isTipsExpanded: true,
    onHowToPrepare: fn(),
  },
}

export const TipsError: Story = {
  args: {
    pantryIngredients,
    tipsError: 'Failed to load tips.',
    isTipsExpanded: true,
    onHowToPrepare: fn(),
    onRetryTips: fn(),
  },
}

export const WithPreparationNotes: Story = {
  args: {
    meal: {
      ...baseMeal,
      preparationNotes: 'Add extra thyme. Kids prefer the skin crispy — broil last 2 min.',
    },
    tips,
    isTipsExpanded: true,
    onHowToPrepare: fn(),
    onHideTips: fn(),
  },
}

export const HideAvailability: Story = {
  args: {
    pantryIngredients,
    hideAvailability: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'For completed/skipped meals — hides checkboxes and missing-ingredient styling.',
      },
    },
  },
}
