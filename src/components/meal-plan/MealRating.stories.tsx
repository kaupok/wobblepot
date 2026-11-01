import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'

import { CookedRatingBadge, MealRatingInline } from './MealRating'

const meta = {
  title: 'Meal plan/MealRating',
  component: MealRatingInline,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof MealRatingInline>

export default meta
type Story = StoryObj<typeof meta>

/** Every button in the story clears the 32px `sm` / `icon-sm` floor (HON-688). */
async function expectButtonsAtFloor(canvasElement: HTMLElement) {
  const buttons = within(canvasElement).getAllByRole('button')
  await expect(buttons.length).toBeGreaterThan(0)
  for (const button of buttons) {
    await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(32)
  }
}

/** The thumbs are a toggle pair: `aria-pressed` names the current rating, and each is 32×32. */
async function expectThumbsPressed(canvasElement: HTMLElement, rating: 'up' | 'down' | null) {
  const canvas = within(canvasElement)
  const up = canvas.getByRole('button', { name: 'Thumbs up' })
  const down = canvas.getByRole('button', { name: 'Thumbs down' })
  await expect(up).toHaveAttribute('aria-pressed', String(rating === 'up'))
  await expect(down).toHaveAttribute('aria-pressed', String(rating === 'down'))
  for (const thumb of [up, down]) {
    const { width, height } = thumb.getBoundingClientRect()
    await expect(width).toBe(32)
    await expect(height).toBe(32)
  }
}

export const InlineNoRating: Story = {
  args: {
    planId: 'plan-1',
    entryId: 'entry-1',
    rating: null,
    onRatingChange: fn(),
  },
  play: async ({ canvasElement }) => {
    await expectButtonsAtFloor(canvasElement)
    await expectThumbsPressed(canvasElement, null)
  },
}

export const InlineThumbsUp: Story = {
  args: {
    planId: 'plan-1',
    entryId: 'entry-1',
    rating: 'up',
    onRatingChange: fn(),
  },
  play: async ({ canvasElement }) => expectThumbsPressed(canvasElement, 'up'),
}

export const InlineThumbsDown: Story = {
  args: {
    planId: 'plan-1',
    entryId: 'entry-1',
    rating: 'down',
    onRatingChange: fn(),
  },
  play: async ({ canvasElement }) => expectThumbsPressed(canvasElement, 'down'),
}

/**
 * The planner card's Cooked badge with the thumbs inside it (HON-1589): each
 * thumb is 20px tall, so the pill keeps a text badge's height, and its
 * `::after` reaches 6px above and below for a 32×32 target.
 */
async function expectBadgeThumbs(canvasElement: HTMLElement, rating: 'up' | 'down' | null) {
  const canvas = within(canvasElement)
  const up = canvas.getByRole('button', { name: 'Thumbs up' })
  const down = canvas.getByRole('button', { name: 'Thumbs down' })
  await expect(up).toHaveAttribute('aria-pressed', String(rating === 'up'))
  await expect(down).toHaveAttribute('aria-pressed', String(rating === 'down'))
  for (const thumb of [up, down]) {
    const { width, height } = thumb.getBoundingClientRect()
    await expect(width).toBe(32)
    await expect(height + 2 * -parseFloat(getComputedStyle(thumb, '::after').top)).toBe(32)
  }
}

export const CookedBadgeUnrated: StoryObj = {
  render: () => <CookedRatingBadge planId="plan-1" entryId="entry-1" rating={null} />,
  play: async ({ canvasElement }) => expectBadgeThumbs(canvasElement, null),
}

export const CookedBadgeUp: StoryObj = {
  render: () => <CookedRatingBadge planId="plan-1" entryId="entry-1" rating="up" />,
  play: async ({ canvasElement }) => expectBadgeThumbs(canvasElement, 'up'),
}

export const CookedBadgeDown: StoryObj = {
  render: () => <CookedRatingBadge planId="plan-1" entryId="entry-1" rating="down" />,
  play: async ({ canvasElement }) => expectBadgeThumbs(canvasElement, 'down'),
}

/** Read-only: the chosen thumb, not a button. */
export const CookedBadgeReadOnly: StoryObj = {
  render: () => <CookedRatingBadge planId="plan-1" entryId="entry-1" rating="up" isReadOnly />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Thumbs up')).toBeInTheDocument()
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument()
  },
}
