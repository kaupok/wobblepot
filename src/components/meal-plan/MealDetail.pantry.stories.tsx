import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { type ComponentProps, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Heading } from '@/components/ui/typography'
import {
  createMeal,
  lemonGarlicChickenComponentsFull,
  lemonGarlicChickenPantryWithOil,
} from '@/stories/fixtures'

import { MealDetail } from './MealDetail'
import type { PantryIngredient } from './types'

/**
 * The cook view's pantry states: the status after the Ingredients heading and
 * the missing rows, as ticks change the pantry. `MealDetail.stories.tsx` is at
 * its file-size cap, so these live here.
 */

const mealFixture = createMeal({ components: lemonGarlicChickenComponentsFull })

const meta = {
  title: 'Meal plan/MealDetail/Pantry',
  component: MealDetail,
  parameters: { layout: 'fullscreen' },
  args: {
    meal: mealFixture,
    householdServings: 4,
    title: <Heading variant="display">{mealFixture.name}</Heading>,
  },
  decorators: [
    (Story) => (
      <div className="bg-card h-dvh">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MealDetail>

export default meta
type Story = StoryObj<typeof meta>

const staplesOnlyPantry: PantryIngredient[] = [
  { ingredientId: 'garlic', isStaple: true },
  { ingredientId: 'olive-oil', isStaple: true },
  { ingredientId: 'salt', isStaple: true },
]

/** Ingredient rows styled as missing (`Li` with the warning tone). */
function missingRows(canvasElement: HTMLElement): HTMLElement[] {
  return within(canvasElement)
    .getAllByRole('listitem')
    .filter((row) => row.classList.contains('text-warning'))
}

export const StaplesOnlyPantry: Story = {
  args: {
    pantryIngredients: staplesOnlyPantry,
    onToggleAvailability: fn(),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Every household starts with salt, black pepper and water as staples (HON-769). A pantry holding only staples says nothing yet: the checkboxes stay, because they are how the user starts filling the pantry, but there is no status after the heading and no row is marked missing (HON-824).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Every ingredient is a row with a checkbox, the staples too (HON-1599).
    await expect(canvas.getAllByRole('checkbox')).toHaveLength(5)
    await expect(canvas.queryByText(/to buy|all at home/i)).toBeNull()
    await expect(missingRows(canvasElement)).toHaveLength(0)
  },
}

/**
 * Holds the pantry in state so a tick adds the ingredient, as the refresh after
 * `MealDetailModal`'s toggle does.
 */
function StaplesOnlyPantryTickRender(args: ComponentProps<typeof MealDetail>) {
  const [pantry, setPantry] = useState(staplesOnlyPantry)
  return (
    <MealDetail
      {...args}
      pantryIngredients={pantry}
      onToggleAvailability={(ingredientId, hasIt) => {
        args.onToggleAvailability?.(ingredientId, hasIt)
        setPantry((prev) =>
          hasIt
            ? [...prev, { ingredientId, isStaple: false }]
            : prev.filter((p) => p.ingredientId !== ingredientId),
        )
      }}
    />
  )
}

export const StaplesOnlyPantryTick: Story = {
  name: 'Staples-only pantry, first tick',
  args: { onToggleAvailability: fn() },
  render: StaplesOnlyPantryTickRender,
  parameters: {
    docs: {
      description: {
        story:
          'Ticking the first ingredient gives the pantry data, so the status and the missing styling appear for the rest (HON-824).',
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText(/to buy/i)).toBeNull()

    await userEvent.click(canvas.getByRole('checkbox', { name: 'Mark Chicken thigh as available' }))

    await expect(args.onToggleAvailability).toHaveBeenCalledWith('chicken-thigh', true)
    await expect(await canvas.findByText('2 to buy')).toBeInTheDocument()
    await expect(missingRows(canvasElement).map((row) => row.textContent)).toEqual([
      expect.stringContaining('Potato'),
      expect.stringContaining('Lemon'),
    ])
  },
}

const fullPantry: PantryIngredient[] = [
  ...lemonGarlicChickenPantryWithOil,
  { ingredientId: 'potato', isStaple: false },
  { ingredientId: 'lemon', isStaple: false },
]

/** Holds a full pantry in state, so a tick or untick changes it. */
function FullPantryToggleRender(args: ComponentProps<typeof MealDetail>) {
  const [pantry, setPantry] = useState(fullPantry)
  return (
    <MealDetail
      {...args}
      pantryIngredients={pantry}
      onToggleAvailability={(ingredientId, hasIt) =>
        setPantry((prev) =>
          hasIt
            ? [...prev, { ingredientId, isStaple: false }]
            : prev.filter((p) => p.ingredientId !== ingredientId),
        )
      }
    />
  )
}

export const AllAtHomeToggle: Story = {
  name: 'All at home, untick and tick again',
  render: FullPantryToggleRender,
  parameters: {
    docs: {
      description: {
        story:
          'Everything at home: the Ingredients heading shows no status. Unticking one shows "1 to buy"; ticking it again removes it (HON-1620).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { name: 'Ingredients' })
    await expect(heading.parentElement!.children).toHaveLength(1)

    await userEvent.click(canvas.getByRole('checkbox', { name: /^Mark Potato as/ }))
    await expect(await canvas.findByText('1 to buy')).toHaveClass('text-warning')

    await userEvent.click(canvas.getByRole('checkbox', { name: /^Mark Potato as/ }))
    await expect(canvas.queryByText(/to buy/)).toBeNull()
    await expect(heading.parentElement!.children).toHaveLength(1)
  },
}
