import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { MealType } from '@/generated/prisma/enums'
import { EmptySlotCard } from './EmptySlotCard'

const meta = {
  title: 'Meal plan/EmptySlotCard',
  component: EmptySlotCard,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    planId: 'plan-1',
    date: '2026-04-20',
    householdSize: 4,
  },
  decorators: [
    (Story) => (
      <div className="max-w-xs">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EmptySlotCard>

export default meta
type Story = StoryObj<typeof meta>

export const Breakfast: Story = {
  args: { mealType: MealType.breakfast },
}

export const Lunch: Story = {
  args: { mealType: MealType.lunch },
}

export const Dinner: Story = {
  args: { mealType: MealType.dinner },
}
