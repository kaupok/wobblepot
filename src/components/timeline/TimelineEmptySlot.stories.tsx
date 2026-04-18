import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { MealType } from '@/generated/prisma/enums'
import { lemonGarlicChickenPantry } from '@/stories/fixtures'
import { slowCreateEntryHandlers } from '@/stories/msw-handlers'
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
