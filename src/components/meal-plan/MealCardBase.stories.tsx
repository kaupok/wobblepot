import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { Heart, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CardContent } from '@/components/ui/card'
import { MealType } from '@/generated/prisma/enums'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import { createMealCardBaseData, createMealComponent } from '@/stories/fixtures'
import { MealCardBase } from './MealCardBase'
import { MealImageCard } from './MealImageCard'
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

export const IngredientsNever: Story = {
  name: 'Ingredients: never',
  args: { meal: mealFixture, ingredients: 'never' },
  parameters: {
    docs: {
      description: {
        story:
          '`ingredients="never"` leaves the list out of the DOM at every width. The recipe library passes it: there the list is uncoloured names only, it made a phone card nearly two screens tall (HON-784) and a desktop card nearly one viewport (HON-819). The edit page and meal detail carry the list with quantities.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: mealFixture.name })).toBeVisible()
    await expect(canvasElement.querySelector('ul')).toBeNull()
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

/** The default, `mealTypes="show"`: one badge per slot, as in the recipe library. */
export const MultipleMealTypes: Story = {
  args: {
    meal: createMealCardBaseData({
      name: 'Shakshuka',
      suitableFor: [MealType.breakfast, MealType.lunch, MealType.dinner],
      primaryProteinType: 'eggs',
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const slot of ['Breakfast', 'Lunch', 'Dinner']) {
      await expect(canvas.getByText(slot)).toBeInTheDocument()
    }
  },
}

/**
 * `mealTypes="hide"`: the meal selector's cards, where the dialog title already
 * names the slot. Kid-friendly and protein stay (HON-945).
 */
export const MealTypesHidden: Story = {
  args: {
    meal: createMealCardBaseData({
      name: 'Shakshuka',
      suitableFor: [MealType.breakfast, MealType.lunch, MealType.dinner],
      primaryProteinType: 'eggs',
    }),
    mealTypes: 'hide',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const slot of ['Breakfast', 'Lunch', 'Dinner']) {
      await expect(canvas.queryByText(slot)).not.toBeInTheDocument()
    }
    await expect(canvas.getByText('Eggs')).toBeInTheDocument()
  },
}

/**
 * One of the household's own recipes, as the meal selector shows it among
 * library meals: the compact "My recipe" badge after the protein badge
 * (HON-948).
 */
export const OwnRecipe: Story = {
  args: {
    meal: createMealCardBaseData({ isCustom: true }),
    mealTypes: 'hide',
  },
  play: async ({ canvasElement }) => {
    const badge = within(canvasElement)
      .getByText('My recipe')
      .closest<HTMLElement>('[data-slot="badge"]')!
    await expect(badge).toHaveAttribute('title', 'My recipe')
    const row = [...badge.parentElement!.querySelectorAll('[data-slot="badge"]')]
    await expect(row.at(-1)).toBe(badge)
  },
}

/** `ownRecipe="hide"`: the My recipes page, where every card is one (HON-948). */
export const OwnRecipeHidden: Story = {
  args: {
    meal: createMealCardBaseData({ isCustom: true }),
    ownRecipe: 'hide',
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText('My recipe')).not.toBeInTheDocument()
  },
}

export const NoDescription: Story = {
  args: {
    meal: createMealCardBaseData({ description: null }),
  },
}

/** Lemon is missing; chicken is in the pantry and garlic and olive oil are staples. */
const somePantry = [
  { ingredientId: 'chicken-thigh', isStaple: false },
  { ingredientId: 'garlic', isStaple: true },
  { ingredientId: 'olive-oil', isStaple: true },
] satisfies PantryIngredient[]

const fullPantry = [
  ...somePantry,
  { ingredientId: 'lemon', isStaple: false },
] satisfies PantryIngredient[]

export const WithPantryAvailability: Story = {
  name: 'Pantry: some missing',
  args: { meal: mealFixture, pantryIngredients: somePantry },
  parameters: {
    docs: {
      description: {
        story:
          'With pantry data each ingredient carries a check (available) or a minus (missing) in place of its bullet, visually hidden text naming the state, and the colour: green available, amber missing. Colour is never the only cue (docs/DESIGN.md → Color, HON-816). Staples count as available.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const items = within(canvasElement).getAllByRole('listitem')
    await expect(items.map((li) => li.textContent)).toEqual([
      'Chicken thigh, available',
      'Garlic, available',
      'Lemon, not available',
      'Olive oil, available',
    ])
    await expect(items[2]!.querySelector('svg')).toHaveClass('lucide-minus')
    await expect(items[0]!.querySelector('svg')).toHaveClass('lucide-check')
  },
}

export const PantryAllAvailable: Story = {
  name: 'Pantry: all available',
  args: { meal: mealFixture, pantryIngredients: fullPantry },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText(', not available')).not.toBeInTheDocument()
    await expect(canvas.getAllByText(', available')).toHaveLength(4)
  },
}

export const NoPantryData: Story = {
  name: 'Pantry: no data',
  args: { meal: mealFixture },
  parameters: {
    docs: {
      description: {
        story:
          'Without `pantryIngredients` the list is muted names with bullets: no icons and no state text, since there is no state to name.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const list = within(canvasElement).getByRole('list')
    await expect(list).toHaveClass('list-disc')
    await expect(list.querySelector('svg')).toBeNull()
  },
}

const tintedMeal = createMealCardBaseData({
  imageStatus: 'ready',
  imageUrl: mealIllustration.src,
  imageHue: 52,
})

/**
 * The marks on the meal's tint, where the alternatives grid shows them. The
 * success and warning colours are measured against every hue in
 * `src/lib/meal-tint.test.ts`; this story puts the axe gate on them too.
 */
export const PantryOnTint: Story = {
  name: 'Pantry: some missing, on a tinted card',
  args: { meal: tintedMeal, pantryIngredients: somePantry },
  decorators: [
    (Story, { args }) => (
      <MealImageCard meal={args.meal} layout="bottom" size="sm">
        <CardContent className="p-4">
          <Story />
        </CardContent>
      </MealImageCard>
    ),
  ],
}

/** An own recipe on the selector's tinted card: the chip colour, no ring (HON-948). */
export const OwnRecipeOnTint: Story = {
  args: { meal: { ...tintedMeal, isCustom: true }, mealTypes: 'hide' },
  decorators: PantryOnTint.decorators,
  play: async ({ canvasElement }) => {
    const badge = within(canvasElement)
      .getByText('My recipe')
      .closest<HTMLElement>('[data-slot="badge"]')!
    await expect(getComputedStyle(badge).borderTopColor).toBe('rgba(0, 0, 0, 0)')
  },
}

export const OwnRecipeOnTintDark: Story = {
  ...OwnRecipeOnTint,
  globals: { theme: 'dark' },
  play: undefined,
}

export const PantryOnTintDark: Story = {
  ...PantryOnTint,
  name: 'Pantry: some missing, on a tinted card (dark)',
  globals: { theme: 'dark' },
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
