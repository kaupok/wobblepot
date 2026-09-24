import type { CSSProperties } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { MealType } from '@/generated/prisma/enums'
import { MealTypeBadge } from './MealTypeBadge'

const meta = {
  title: 'Meal plan/MealTypeBadge',
  component: MealTypeBadge,
  tags: ['autodocs'],
  args: { mealType: MealType.dinner },
} satisfies Meta<typeof MealTypeBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Dinner: Story = {}

export const Lunch: Story = { args: { mealType: MealType.lunch } }

export const Breakfast: Story = { args: { mealType: MealType.breakfast } }

/** On a tinted meal surface the chip takes the meal's hue, as inside a planner card with an illustration. */
export const OnTintedSurface: Story = {
  render: (args) => (
    // `--meal-hue` is the one per-meal value (docs/DESIGN.md → Imagery); the
    // surface derives every colour from it.
    <div data-meal-surface="" style={{ '--meal-hue': 52 } as CSSProperties} className="p-4">
      <MealTypeBadge {...args} />
    </div>
  ),
}

export const AllTypes: Story = {
  render: () => (
    <div className="flex gap-2">
      <MealTypeBadge mealType={MealType.breakfast} />
      <MealTypeBadge mealType={MealType.lunch} />
      <MealTypeBadge mealType={MealType.dinner} />
    </div>
  ),
}
