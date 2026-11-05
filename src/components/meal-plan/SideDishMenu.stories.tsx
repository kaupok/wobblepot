import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { awaitDialogClosed, pressEscape } from '@/stories/a11y-helpers'
import { createMeal } from '@/stories/fixtures'

import { SideDishMenu } from './SideDishMenu'
import type { PlanEntrySide } from './types'

const salad: PlanEntrySide = {
  entryId: 'side-salad',
  mealId: 'meal-salad',
  mealName: 'Cucumber salad',
  servings: 3,
  cookServings: 3,
  status: 'planned',
  rating: null,
  servingOverride: null,
  pantryDeducted: false,
  components: [],
  meal: createMeal({ id: 'meal-salad', name: 'Cucumber salad' }),
  preparationTips: null,
  conflicts: [],
}

const meta = {
  title: 'Meal plan/SideDishMenu',
  component: SideDishMenu,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The menu a side dish line opens on a planner card (HON-1611): Servings and Swap for a planned side, Steps for its cook view, the thumbs for a cooked side, and Remove with Undo in the toast. Each dialog returns focus to the line.',
      },
    },
    msw: {
      handlers: [
        http.patch('/api/meal-plans/:planId/entries/:entryId', () =>
          HttpResponse.json({ id: 'side-salad' }),
        ),
      ],
    },
  },
  args: {
    side: salad,
    planId: 'plan-1',
    date: '2026-10-12',
    mealType: 'dinner',
    householdServings: 3,
    mainMealName: 'Lemon-garlic roast chicken',
    takenMealIds: ['meal-1', 'meal-salad'],
    onRemoved: fn(),
  },
} satisfies Meta<typeof SideDishMenu>

export default meta
type Story = StoryObj<typeof meta>

const body = within(document.body)
const items = async () => (await body.findAllByRole('menuitem')).map((item) => item.textContent)

/** A planned side: Servings, Swap, Steps and Remove. */
export const Planned: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: '+ Cucumber salad · 3' }),
    )
    await waitFor(async () =>
      expect(await items()).toEqual(['Servings', 'Swap', 'Steps', 'Remove']),
    )
    await userEvent.keyboard('{Escape}')
  },
}

/** Servings opens a dialog with the serving control; closing it returns focus to the line. */
export const ServingsDialog: Story = {
  play: async ({ canvasElement }) => {
    const line = within(canvasElement).getByRole('button', {
      name: '+ Cucumber salad · 3',
    })
    await userEvent.click(line)
    await userEvent.click(await body.findByRole('menuitem', { name: 'Servings' }))
    const dialog = within(await body.findByRole('dialog', { name: 'Side dish servings' }))
    await expect(dialog.getByRole('button', { name: 'Serves 3. Click to edit.' })).toBeVisible()
    await pressEscape()
    await awaitDialogClosed()
    await waitFor(() => expect(line).toHaveFocus())
  },
}

/** A cooked side: the thumbs instead of Servings and Swap. */
export const Cooked: Story = {
  args: { side: { ...salad, status: 'completed', rating: 'up' } },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: '+ Cucumber salad · 3' }),
    )
    await expect(await body.findByRole('menuitemcheckbox', { name: 'Thumbs up' })).toBeChecked()
    await userEvent.keyboard('{Escape}')
  },
}

/** A planned side that breaks a food preference: its badge follows the line (HON-1611). */
export const WithConflict: Story = {
  args: { side: { ...salad, conflicts: [{ kind: 'allergen', constraint: 'dairy' }] } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Contains: Dairy')).toBeVisible()
  },
}
