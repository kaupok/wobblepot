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

export const Default: Story = {
  args: { meal: mealFixture },
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

export const WithPantryAvailability: Story = {
  args: {
    meal: mealFixture,
    pantryIngredients: [
      { ingredientId: 'short-grain-rice', isStaple: true },
      { ingredientId: 'miso-paste', isStaple: true },
    ] satisfies PantryIngredient[],
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
