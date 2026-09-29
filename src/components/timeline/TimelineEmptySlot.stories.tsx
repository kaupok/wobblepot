import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import { lemonGarlicChickenPantry } from '@/stories/fixtures'
import {
  defaultHandlers,
  slowCreateEntryHandlers,
  slowDiscardEntryHandlers,
} from '@/stories/msw-handlers'
import { awaitDialogClosed, pressEscape } from '@/stories/a11y-helpers'
import { TimelineEmptySlot } from './TimelineEmptySlot'

const meta = {
  title: 'Feature/Timeline/TimelineEmptySlot',
  component: TimelineEmptySlot,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    planId: 'plan-1',
    date: '2026-04-16',
    dayLabel: 'Thursday Apr 16',
    mealType: MealType.dinner,
    householdSize: 4,
    pantryIngredients: lemonGarlicChickenPantry,
  },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TimelineEmptySlot>

export default meta
type Story = StoryObj<typeof meta>

// The button's name carries the slot: every empty slot on Today reads "Pick a
// meal", so the name adds the day and meal after the visible text (HON-807).
export const Dinner: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', {
        name: 'Pick a meal: Thursday Apr 16, Dinner',
      }),
    ).toBeVisible()
  },
}

export const Lunch: Story = {
  args: { mealType: MealType.lunch },
}

export const Breakfast: Story = {
  args: { mealType: MealType.breakfast },
}

/** Today and Tomorrow have no date beside them, so the day is the word alone. */
export const Tomorrow: Story = {
  args: { dayLabel: 'Tomorrow' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Pick a meal: Tomorrow, Dinner' }),
    ).toBeVisible()
  },
}

export const Adding: Story = {
  parameters: {
    msw: { handlers: slowCreateEntryHandlers },
    docs: {
      description: {
        story:
          "The create-entry POST never resolves, so clicking 'Pick a meal' leaves the button in the 'Adding...' pending state: aria-disabled, so it keeps focus (HON-803).",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Pick a meal/ }))
    const adding = await canvas.findByRole('button', {
      name: 'Adding…: Thursday Apr 16, Dinner',
    })
    await expect(adding).toHaveAttribute('aria-disabled', 'true')
  },
}

export const Discarding: Story = {
  parameters: {
    msw: { handlers: [...slowDiscardEntryHandlers, ...defaultHandlers] },
    docs: {
      description: {
        story:
          "The selector is closed without a pick and the placeholder DELETE never resolves: the selector closes at once, and 'Pick a meal' stays aria-disabled until the discard settles (HON-799). It is aria-disabled rather than disabled so it can take focus back from the selector (HON-803).",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Pick a meal/ }))
    const dialog = await within(document.body).findByRole('dialog')
    // The dialog covers the row that was tapped, so it names the slot (HON-807).
    await expect(dialog).toHaveAccessibleDescription('Thursday Apr 16 · Dinner')
    await pressEscape()
    await awaitDialogClosed()
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: /^Pick a meal/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
  },
}
