import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Heart, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
          "`nameHeadingTag` moves the meal name in the document outline without changing its size — it stays at the Section level (`text-base`), one step below the page or dialog title it sits under (HON-784). Callers inside a Dialog pass `h3` so the tag follows the Dialog title (an `h2`) and axe's heading-order rule stays valid.",
      },
    },
  },
}

export const IngredientsAlways: Story = {
  name: 'Ingredients: always (phone)',
  args: { meal: mealFixture, ingredients: 'always' },
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story:
          'The default. The alternatives grid keeps the ingredient list at every width, because there it is colour-coded against the pantry and is how a household picks between swaps. The imagine panel and results also keep the default.',
      },
    },
  },
}

export const IngredientsMdUp: Story = {
  name: 'Ingredients: md and up (phone)',
  args: { meal: mealFixture, ingredients: 'md-up' },
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story:
          '`ingredients="md-up"` hides the list below `md`. The recipe library passes it: there the list is uncoloured names only, and on a phone it made each card nearly two screens tall (HON-784). Widen the viewport past `md` to see the list return.',
      },
    },
  },
}

export const WithTitleActions: Story = {
  args: {
    meal: mealFixture,
    titleActions: (
      <>
        <Button variant="ghost" size="sm" aria-label="Add to favorites">
          <Heart className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" aria-label="Edit meal">
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" aria-label="Delete meal">
          <Trash2 className="h-4 w-4" />
        </Button>
      </>
    ),
  },
  parameters: {
    docs: {
      description: {
        story:
          '`titleActions` aligns the card\'s actions right on the name\'s row (docs/DESIGN.md → "Actions sit on the title row"). The recipe library grid passes favourite, edit and delete here.',
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

export const WithOnlyDefaultStaples: Story = {
  args: {
    meal: mealFixture,
    pantryIngredients: [
      { ingredientId: 'garlic', isStaple: true },
      { ingredientId: 'olive-oil', isStaple: true },
    ] satisfies PantryIngredient[],
  },
  parameters: {
    docs: {
      description: {
        story:
          'A pantry holding only staples, which is how every household starts (HON-769), is not treated as pantry data: the list stays uncoloured rather than marking everything else missing.',
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
