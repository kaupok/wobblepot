import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
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

/** The footer's content box: `CardFooter` with the card's `p-4`. */
function footerContentBox(button: HTMLElement) {
  const footer = button.closest<HTMLElement>('[data-slot="card-footer"]')!
  const { paddingLeft, paddingRight } = getComputedStyle(footer)
  const left = footer.getBoundingClientRect().left + parseFloat(paddingLeft)
  const width = footer.clientWidth - parseFloat(paddingLeft) - parseFloat(paddingRight)
  return { left, width }
}

/**
 * Below `md` the cards stack, so Select spans the card for a column-wide target
 * (HON-943). The fixture is a dinner, but the card leaves the meal-type badge
 * out: the dialog's title names the slot (HON-945).
 */
export const Default: Story = {
  args: { meal: mealFixture },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: 'Select' })
    await expect(button.getBoundingClientRect().width).toBe(footerContentBox(button).width)
    await expect(canvas.queryByText('Dinner')).not.toBeInTheDocument()
  },
}

/**
 * From `md` the dialog lays three cards in a row. Each Select is `outline` and
 * as wide as its label, at the start of the card, so the row does not read as
 * three equal black bars (HON-943, DESIGN.md → Reject list).
 */
export const Desktop: Story = {
  args: { meal: mealFixture },
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Select' })
    const box = button.getBoundingClientRect()
    const content = footerContentBox(button)
    await expect(box.width).toBeLessThan(content.width / 2)
    await expect(box.left).toBe(content.left)
    await expect(button).toHaveAttribute('data-variant', 'outline')
  },
}

/** The dialog's tall card puts the image below the ingredients, above Select (HON-750). */
export const WithImage: Story = {
  args: {
    meal: {
      ...mealFixture,
      imageStatus: 'ready',
      imageUrl: mealIllustration.src,
      imageHue: 200,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('img', { name: mealFixture.name })
    const box = canvas.getByTestId('meal-card-image').getBoundingClientRect()
    await expect(canvas.getByRole('list').getBoundingClientRect().bottom).toBeLessThanOrEqual(
      box.top,
    )
    await expect(
      canvas.getByRole('button', { name: 'Select' }).getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(box.bottom)
  },
}

/**
 * One of the household's own recipes among the suggestions or search results:
 * the "My recipe" icon after the name, which a library meal does not get
 * (HON-948, HON-973).
 */
export const OwnRecipe: Story = {
  args: { meal: { ...mealFixture, isCustom: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const icon = canvas.getByRole('button', { name: 'My recipe' })
    await expect(icon).not.toHaveAttribute('title')
    await expect(canvas.getByRole('heading', { level: 3 })).toContainElement(icon)
  },
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
    },
  },
}

/** Salmon is in the pantry and miso is a staple; the rice is missing. */
const somePantry = [
  { ingredientId: 'salmon-fillet', isStaple: false },
  { ingredientId: 'miso-paste', isStaple: true },
] satisfies PantryIngredient[]

const fullPantry = [
  ...somePantry,
  { ingredientId: 'short-grain-rice', isStaple: false },
] satisfies PantryIngredient[]

const tintedMeal = {
  ...mealFixture,
  imageStatus: 'ready' as const,
  imageUrl: mealIllustration.src,
  imageHue: 200,
}

/**
 * Each ingredient carries an icon and hidden state text as well as its colour,
 * and the card's last content row gives the pantry's verdict, as the card on
 * Today does (HON-816). The badge counts exactly the rows marked missing.
 */
export const WithPantryAvailability: Story = {
  name: 'Pantry: some missing',
  args: { meal: tintedMeal, pantryIngredients: somePantry },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('1 ingredient to buy')).toBeVisible()
    await expect(canvas.getAllByText(', not available')).toHaveLength(1)
    await expect(canvas.getByText('Short-grain rice').closest('li')).toHaveTextContent(
      'Short-grain rice, not available',
    )
  },
}

export const WithPantryAvailabilityDark: Story = {
  ...WithPantryAvailability,
  name: 'Pantry: some missing (dark)',
  globals: { theme: 'dark' },
}

export const PantryAllAvailable: Story = {
  name: 'Pantry: all available',
  args: { meal: tintedMeal, pantryIngredients: fullPantry },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Have all ingredients')).toBeVisible()
    await expect(canvas.queryByText(', not available')).not.toBeInTheDocument()
  },
}

export const PantryAllAvailableDark: Story = {
  ...PantryAllAvailable,
  name: 'Pantry: all available (dark)',
  globals: { theme: 'dark' },
}

/**
 * No pantry data, or a pantry holding only the default staples (HON-769):
 * bulleted muted names and no badge, rather than a badge calling every
 * non-staple missing.
 */
export const PantryOnlyStaples: Story = {
  name: 'Pantry: no data (staples only)',
  args: {
    meal: tintedMeal,
    pantryIngredients: [
      { ingredientId: 'short-grain-rice', isStaple: true },
      { ingredientId: 'miso-paste', isStaple: true },
    ] satisfies PantryIngredient[],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText(/ingredients? to buy|Have all ingredients/)).toBeNull()
    await expect(canvas.getByRole('list')).toHaveClass('list-disc')
  },
}

/** The household's own thumbs moved this suggestion up the ranking (HON-340). */
export const RatedUp: Story = {
  args: { meal: { ...mealFixture, ratingSignal: 'liked' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("You've rated this thumbs up")).toBeVisible()
  },
}

/** Rated down on balance, but still in the top 3 — the card says so rather than hiding it. */
export const RatedDown: Story = {
  args: { meal: { ...mealFixture, ratingSignal: 'disliked' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("You've rated this thumbs down")).toBeVisible()
  },
}
