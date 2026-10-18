import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { ChangedBadge } from './ChangedBadge'

const meta = {
  title: 'Meal plan/ChangedBadge',
  component: ChangedBadge,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'On a planner card whose entry has its own ingredient changes (HON-1243), beside the conflict badges.',
      },
    },
  },
} satisfies Meta<typeof ChangedBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Changed')).toBeVisible()
  },
}
