import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'
import { MealRatingInline, MealRatingPrompt, RatingBadge } from './MealRating'

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

export const Prompt: StoryObj = {
  parameters: {
    docs: {
      description: {
        story: 'Shown after marking a meal as completed — asks the user to rate their experience.',
      },
    },
  },
  render: () => (
    <MealRatingPrompt planId="plan-1" entryId="entry-1" onRated={fn()} onDismiss={fn()} />
  ),
  play: async ({ canvasElement }) => expectButtonsAtFloor(canvasElement),
}

export const BadgeUp: StoryObj = {
  render: () => <RatingBadge rating="up" />,
}

export const BadgeDown: StoryObj = {
  render: () => <RatingBadge rating="down" />,
}

export const BadgeClickable: StoryObj = {
  parameters: {
    docs: {
      description: {
        story: 'The badge becomes an interactive button when `onClick` is provided.',
      },
    },
  },
  render: () => <RatingBadge rating="up" onClick={fn()} />,
  play: async ({ canvasElement }) => expectButtonsAtFloor(canvasElement),
}
