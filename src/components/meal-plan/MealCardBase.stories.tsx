import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { MealType } from '@/generated/prisma/enums'
import { createMealCardBaseData, createMealComponent } from '@/stories/fixtures'
import { MealCardBase } from './MealCardBase'
import type { PantryIngredient } from './types'

const mealFixture = createMealCardBaseData()

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
  args: { meal: mealFixture },
}

export const NameAsH3: Story = {
  name: 'Meal name tag override',
  args: { meal: mealFixture, nameHeadingTag: 'h3' },
  parameters: {
    docs: {
      description: {
        story:
          "`nameHeadingTag` moves the meal name in the document outline without changing its size — it stays at the `h4` title level (`text-xl`). Callers inside a Dialog pass `h3` so the tag follows the Dialog title (an `h2`) and axe's heading-order rule stays valid.",
      },
    },
  },
}

export const WithSourceUrl: Story = {
  args: {
    meal: createMealCardBaseData({
      sourceUrl: 'https://example.com/recipes/lemon-garlic-chicken',
    }),
  },
}

export const NotKidFriendly: Story = {
  args: {
    meal: createMealCardBaseData({
      name: 'Spicy harissa salmon',
      description: 'Adults-only weeknight dinner with a kick.',
      kidFriendly: false,
      primaryProteinType: 'fish',
    }),
  },
}

export const MultipleMealTypes: Story = {
  args: {
    meal: createMealCardBaseData({
      name: 'Shakshuka',
      suitableFor: [MealType.breakfast, MealType.lunch, MealType.dinner],
      primaryProteinType: 'eggs',
    }),
  },
}

export const NoDescription: Story = {
  args: {
    meal: createMealCardBaseData({ description: null }),
  },
}

export const WithPantryAvailability: Story = {
  args: {
    meal: mealFixture,
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
    meal: createMealCardBaseData({
      name: 'Mushroom risotto',
      description: 'Creamy arborio risotto with wild mushrooms and parmesan.',
      timeMinutes: 35,
      primaryProteinType: 'none',
      components: [
        createMealComponent({
          ingredientId: 'arborio-rice',
          quantityPerServing: 80,
          ingredient: {
            id: 'arborio-rice',
            name: 'Arborio rice',
            category: 'grain',
            defaultUnit: 'g',
            gramsPerPiece: null,
          },
        }),
        createMealComponent({
          ingredientId: 'mushrooms',
          quantityPerServing: 100,
          ingredient: {
            id: 'mushrooms',
            name: 'Mixed mushrooms',
            category: 'produce',
            defaultUnit: 'g',
            gramsPerPiece: null,
          },
        }),
      ],
      nutrition: { calories: 420, protein: 12, carbs: 68, fat: 10 },
    }),
  },
}
