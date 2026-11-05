import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { SideDishLines } from './SideDishLines'
import type { PlanEntrySide } from './types'

const side = (overrides: Partial<PlanEntrySide>): PlanEntrySide => ({
  entryId: 'side-salad',
  mealId: 'meal-salad',
  mealName: 'Cucumber, tomato and sour cream salad',
  servings: 3,
  cookServings: 3,
  status: 'planned',
  rating: null,
  servingOverride: null,
  pantryDeducted: false,
  components: [],
  ...overrides,
})

const meta = {
  title: 'Meal plan/SideDishLines',
  component: SideDishLines,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "The side dishes under a main card's name (HON-1610): one muted line per side, `+ {name} · {servings}`, the fridge card's `withItems` form. Read-only until the planner can add a side (HON-1611).",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-64">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SideDishLines>

export default meta
type Story = StoryObj<typeof meta>

/** One side at the main's servings. */
export const OneSide: Story = {
  args: { sides: [side({ mealName: 'Cucumber salad' })] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('+ Cucumber salad · 3')).toBeVisible()
  },
}

/** Two sides, one with a long name that wraps, and one with its own servings. */
export const TwoSides: Story = {
  args: {
    sides: [
      side({}),
      side({ entryId: 'side-rice', mealId: 'meal-rice', mealName: 'Steamed rice', servings: 5 }),
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('+ Steamed rice · 5')).toBeVisible()
  },
}

/** No sides: nothing renders. */
export const NoSides: Story = {
  args: { sides: [] },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.textContent).toBe('')
  },
}
