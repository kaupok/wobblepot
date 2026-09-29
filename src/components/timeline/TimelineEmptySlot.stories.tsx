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

export const Dinner: Story = {}

export const Lunch: Story = {
  args: { mealType: MealType.lunch },
}

export const Breakfast: Story = {
  args: { mealType: MealType.breakfast },
}

export const Adding: Story = {
  parameters: {
    msw: { handlers: slowCreateEntryHandlers },
    docs: {
      description: {
        story:
          "The create-entry POST never resolves, so clicking 'Pick a meal' leaves the button in the 'Adding...' disabled state.",
      },
    },
  },
}

export const Discarding: Story = {
  parameters: {
    msw: { handlers: [...slowDiscardEntryHandlers, ...defaultHandlers] },
    docs: {
      description: {
        story:
          "The selector is closed without a pick and the placeholder DELETE never resolves: the selector closes at once, and 'Pick a meal' stays disabled until the discard settles (HON-799).",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Pick a meal' }))
    await within(document.body).findByRole('dialog')
    await pressEscape()
    await awaitDialogClosed()
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Pick a meal' })).toBeDisabled())
  },
}
