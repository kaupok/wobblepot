import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { MealType } from '@/generated/prisma/enums'
import { MealCardBase, type MealCardBaseData } from './MealCardBase'
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
    ingredientId: 'lemon',
    quantityPerServing: 1,
    ingredient: {
      id: 'lemon',
      name: 'Lemon',
      category: 'produce',
      defaultUnit: 'piece',
      gramsPerPiece: 60,
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

const baseMeal: MealCardBaseData = {
  name: 'Lemon-garlic roast chicken',
  description: 'Weeknight-friendly sheet-pan dinner with crisp skin and bright citrus.',
  sourceUrl: null,
  timeMinutes: 45,
  kidFriendly: true,
  primaryProteinType: 'chicken',
  suitableFor: [MealType.dinner],
  components,
  nutrition: { calories: 520, protein: 42, carbs: 8, fat: 35 },
}

const meta = {
  title: 'Meal plan/MealCardBase',
  component: MealCardBase,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="max-w-md rounded-lg border p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MealCardBase>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { meal: baseMeal },
}

export const WithSourceUrl: Story = {
  args: {
    meal: {
      ...baseMeal,
      sourceUrl: 'https://example.com/recipes/lemon-garlic-chicken',
    },
  },
}

export const NotKidFriendly: Story = {
  args: {
    meal: {
      ...baseMeal,
      name: 'Spicy harissa salmon',
      description: 'Adults-only weeknight dinner with a kick.',
      kidFriendly: false,
      primaryProteinType: 'fish',
    },
  },
}

export const MultipleMealTypes: Story = {
  args: {
    meal: {
      ...baseMeal,
      name: 'Shakshuka',
      suitableFor: [MealType.breakfast, MealType.lunch, MealType.dinner],
      primaryProteinType: 'eggs',
    },
  },
}

export const NoDescription: Story = {
  args: {
    meal: { ...baseMeal, description: null },
  },
}

export const WithPantryAvailability: Story = {
  args: {
    meal: baseMeal,
    pantryIngredients: [
      { ingredientId: 'chicken-thigh', isStaple: false },
      { ingredientId: 'garlic', isStaple: true },
      { ingredientId: 'olive-oil', isStaple: true },
    ] satisfies PantryIngredient[],
  },
  parameters: {
    docs: {
      description: {
        story:
          'When pantryIngredients is provided, available ingredients are green and missing ones are amber.',
      },
    },
  },
}

export const Vegetarian: Story = {
  args: {
    meal: {
      ...baseMeal,
      name: 'Mushroom risotto',
      description: 'Creamy arborio risotto with wild mushrooms and parmesan.',
      timeMinutes: 35,
      primaryProteinType: 'none',
      components: [
        {
          ingredientId: 'arborio-rice',
          quantityPerServing: 80,
          ingredient: {
            id: 'arborio-rice',
            name: 'Arborio rice',
            category: 'grain',
            defaultUnit: 'g',
            gramsPerPiece: null,
          },
        },
        {
          ingredientId: 'mushrooms',
          quantityPerServing: 100,
          ingredient: {
            id: 'mushrooms',
            name: 'Mixed mushrooms',
            category: 'produce',
            defaultUnit: 'g',
            gramsPerPiece: null,
          },
        },
      ],
      nutrition: { calories: 420, protein: 12, carbs: 68, fat: 10 },
    },
  },
}
