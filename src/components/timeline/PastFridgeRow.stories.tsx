import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import type { FridgeMealItem } from '@/components/meal-plan/types'
import { RowGroup } from '@/components/ui/row-group'
import { MealType } from '@/generated/prisma/enums'
import { awaitDialogClosed } from '@/stories/a11y-helpers'
import { fridgeItems, fridgePantryItems } from '@/stories/fridge-fixtures'

import { PastFridgeRow } from './PastFridgeRow'

const wolt: FridgeMealItem[] = [
  {
    id: 'i-wolt',
    ingredientId: null,
    sourceEntryId: null,
    label: 'Wolt',
    name: null,
    sourceDate: null,
    servings: null,
  },
]

const meta = {
  title: 'Feature/Timeline/PastFridgeRow',
  component: PastFridgeRow,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    entryId: 'entry-1',
    planId: 'plan-1',
    date: '2026-10-21',
    mealType: MealType.dinner,
    items: fridgeItems,
    status: 'planned',
    pantryItems: fridgePantryItems,
  },
  // The row always sits in its day's `RowGroup`, which draws the box.
  decorators: [
    (Story) => (
      <RowGroup>
        <Story />
      </RowGroup>
    ),
  ],
} satisfies Meta<typeof PastFridgeRow>

export default meta
type Story = StoryObj<typeof meta>

/**
 * A planned fridge meal from a past day (HON-1383). Cooked opens "Did you use
 * anything up?", as "Eaten" does on the Today card, and focus lands on Undo
 * after Done.
 */
export const Planned: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Cooked' }))
    const dialog = await body.findByRole('dialog', { name: 'Did you use anything up?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    await awaitDialogClosed(3000)

    await waitFor(() => expect(canvas.getByRole('button', { name: /^Undo: / })).toHaveFocus())
  },
}

/** Logged on Past meals: already cooked, so only Undo. A fridge meal has no thumbs. */
export const Cooked: Story = {
  args: { items: wolt, status: 'completed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Undo: Wolt' })).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  },
}

export const Skipped: Story = {
  args: { items: wolt, status: 'skipped' },
}
