import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { MealRatingInline, MealRatingPrompt, RatingBadge } from './MealRating'

const meta = {
  title: 'Meal plan/MealRating',
  component: MealRatingInline,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof MealRatingInline>

export default meta
type Story = StoryObj<typeof meta>

export const InlineNoRating: Story = {
  args: {
    planId: 'plan-1',
    entryId: 'entry-1',
    rating: null,
    onRatingChange: fn(),
  },
}

export const InlineThumbsUp: Story = {
  args: {
    planId: 'plan-1',
    entryId: 'entry-1',
    rating: 'up',
    onRatingChange: fn(),
  },
}

export const InlineThumbsDown: Story = {
  args: {
    planId: 'plan-1',
    entryId: 'entry-1',
    rating: 'down',
    onRatingChange: fn(),
  },
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
}
