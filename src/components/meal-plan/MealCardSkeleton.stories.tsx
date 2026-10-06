import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { MealCardSkeleton } from './MealCardSkeleton'

const meta = {
  title: 'Meal plan/MealCardSkeleton',
  component: MealCardSkeleton,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof MealCardSkeleton>

export default meta
type Story = StoryObj<typeof meta>

/** The skeleton's height in px, at whatever width its wrapper gives it. */
function skeletonHeight(canvasElement: HTMLElement) {
  return within(canvasElement).getByRole('status').getBoundingClientRect().height
}

/** A phone card: 358px, a 390px screen less the page's `px-4`. */
export const Phone: Story = {
  decorators: [
    (Story) => (
      <div className="w-[358px]">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    await expect(skeletonHeight(canvasElement)).toBe(156)
  },
}

/** The planner column at the 1152px page width: two description lines more. */
export const Desktop: Story = {
  decorators: [
    (Story) => (
      <div className="w-[776px]">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    await expect(skeletonHeight(canvasElement)).toBe(204)
  },
}
