import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

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
          "The side dishes under a main card's name (HON-1610): one muted line per side, `+ {name} · {servings}`, the fridge card's `withItems` form. With `menu`, each line opens the side's menu (`SideDishMenu`, HON-1611); without it the lines are text.",
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

/** On an editable card: each line is the trigger of the side's menu (HON-1611). */
export const WithMenu: Story = {
  args: {
    sides: [side({ mealName: 'Cucumber salad' })],
    menu: {
      planId: 'plan-1',
      date: '2026-10-12',
      mealType: 'dinner',
      householdServings: 3,
      mainMealName: 'Lemon-garlic roast chicken',
      takenMealIds: ['meal-1', 'meal-salad'],
      onRemoved: fn(),
    },
  },
  play: async ({ canvasElement }) => {
    const line = within(canvasElement).getByRole('button', {
      name: '+ Cucumber salad · 3',
    })
    await expect(line).toHaveTextContent('+ Cucumber salad · 3')
    await userEvent.click(line)
    const servings = await within(document.body).findByRole('menuitem', { name: 'Servings' })
    // The menu fades in.
    await waitFor(() => expect(servings).toBeVisible())
    await userEvent.keyboard('{Escape}')
  },
}
