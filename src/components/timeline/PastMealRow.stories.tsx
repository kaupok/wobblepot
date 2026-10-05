import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import { RowGroup } from '@/components/ui/row-group'
import { createMeal, lemonGarlicChickenPantryItems } from '@/stories/fixtures'
import { awaitDialogClosed } from '@/stories/a11y-helpers'
import { PastMealRow } from './PastMealRow'

const meal = createMeal()

const meta = {
  title: 'Feature/Timeline/PastMealRow',
  component: PastMealRow,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    entryId: 'entry-1',
    planId: 'plan-1',
    meal,
    mealType: MealType.dinner,
    status: 'planned',
    rating: null,
    householdServings: 4,
    pantryItems: lemonGarlicChickenPantryItems,
  },
  // The row always sits in its day's `RowGroup`, which draws the box.
  decorators: [
    (Story) => (
      <RowGroup>
        <Story />
      </RowGroup>
    ),
  ],
} satisfies Meta<typeof PastMealRow>

export default meta
type Story = StoryObj<typeof meta>

const cooked = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('button', { name: 'Cooked' })
const undo = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('button', { name: `Undo: ${meal.name}` })

/**
 * Cooked on an entry the pantry was not charged for previews the deduction.
 * Confirm marks the row cooked, and focus lands on Undo, because Cooked is
 * gone; Undo brings Cooked back and focus with it (HON-1018).
 */
export const Planned: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)

    // One click each, at the 44px touch floor below `md`.
    const skipped = canvas.getByRole('button', { name: 'Skipped' })
    if (window.innerWidth < 768) {
      for (const button of [cooked(canvasElement), skipped]) {
        await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
      }
    }
    // Each button names its meal in its description: a page has one per row.
    await expect(cooked(canvasElement)).toHaveAccessibleDescription(meal.name)

    await userEvent.click(cooked(canvasElement))
    const dialog = await body.findByRole('dialog', { name: 'Mark as completed' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await awaitDialogClosed(3000)

    await expect(canvas.getByText('Cooked')).toBeInTheDocument()
    await waitFor(() => expect(undo(canvasElement)).toHaveFocus())

    await userEvent.click(undo(canvasElement))
    await waitFor(() => expect(cooked(canvasElement)).toHaveFocus())
  },
}

/** Cancel leaves the row planned and focus back on Cooked. */
export const CancelDeduction: Story = {
  play: async ({ canvasElement }) => {
    const body = within(document.body)

    await userEvent.click(cooked(canvasElement))
    const dialog = await body.findByRole('dialog', { name: 'Mark as completed' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await awaitDialogClosed()

    await waitFor(() => expect(cooked(canvasElement)).toHaveFocus())
  },
}

/** Skipped marks the row at once and hands focus to Undo. */
export const SkipThenUndo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'Skipped' }))
    await waitFor(() => expect(undo(canvasElement)).toHaveFocus())
    await expect(canvas.queryByRole('button', { name: 'Skipped' })).not.toBeInTheDocument()
  },
}

export const CookedRated: Story = {
  args: { status: 'completed', rating: 'up' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(undo(canvasElement)).toBeInTheDocument()
  },
}

export const CookedUnrated: Story = {
  args: { status: 'completed', rating: null },
}

export const Skipped: Story = {
  args: { status: 'skipped' },
}

/**
 * Completed once, then reverted. The server never charges an entry twice
 * (HON-651), so Cooked completes with no deduction preview.
 */
export const AlreadyCharged: Story = {
  args: { pantryDeducted: true },
  play: async ({ canvasElement }) => {
    await userEvent.click(cooked(canvasElement))

    await waitFor(() => expect(undo(canvasElement)).toHaveFocus())
    await expect(within(document.body).queryByRole('dialog')).not.toBeInTheDocument()
  },
}

/**
 * A long name on a phone wraps rather than truncates, and the buttons wrap
 * under it, so the row never scrolls sideways.
 */
export const LongName: Story = {
  args: {
    meal: createMeal({
      name: 'Slow-roasted lemon and garlic chicken thighs with crispy smashed potatoes and green beans',
    }),
  },
  decorators: [
    (Story) => (
      <div className="w-[358px]">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = canvasElement.querySelector<HTMLElement>('[data-slot="row-group"]')!
    await expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth)

    const name = canvas.getByText(/^Slow-roasted/).getBoundingClientRect()
    const button = cooked(canvasElement).getBoundingClientRect()
    await expect(button.top).toBeGreaterThanOrEqual(name.bottom)
  },
}
