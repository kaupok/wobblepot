import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { TodaySkeleton } from './TodaySkeleton'

const meta = {
  title: 'Timeline/TodaySkeleton',
  component: TodaySkeleton,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TodaySkeleton>

export default meta
type Story = StoryObj<typeof meta>

/** Two of today's meal cards and one of tomorrow's, at `MealCardSkeleton` height. */
function mealCardSkeletons(canvasElement: HTMLElement) {
  return within(canvasElement)
    .getAllByRole('status')
    .filter((skeleton) => skeleton.parentElement?.classList.contains('@container'))
}

/** Phones: the meals column only, like the real sidebar (HON-766). */
export const Phone: Story = {
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  play: async ({ canvasElement }) => {
    await expect(mealCardSkeletons(canvasElement)).toHaveLength(3)
    await expect(within(canvasElement).getByTestId('today-skeleton-shopping')).not.toBeVisible()
  },
}

/** From `lg`: the shopping summary column beside the meals. */
export const Desktop: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvasElement }) => {
    await expect(mealCardSkeletons(canvasElement)).toHaveLength(3)
    await expect(within(canvasElement).getByTestId('today-skeleton-shopping')).toBeVisible()
  },
}
