import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { User } from 'lucide-react'
import { Body } from '@/components/ui/typography'
import { AttentionDot } from './attention-dot'

const meta = {
  title: 'Feature/Navigation/AttentionDot',
  component: AttentionDot,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A small red dot that marks a menu entry needing attention: the account icon and its "Past meals" row while past meals are still to mark (HON-1028). It is `aria-hidden`; the control it sits on says the same thing in its accessible name. The caller places it with `className`.',
      },
    },
  },
} satisfies Meta<typeof AttentionDot>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const dot = canvasElement.querySelector('[data-slot="attention-dot"]')
    await expect(dot).toHaveAttribute('aria-hidden', 'true')
  },
}

export const OnIcon: Story = {
  parameters: {
    docs: {
      description: {
        story: 'At the top-right of the account icon, as on the header trigger.',
      },
    },
  },
  render: () => (
    <span className="relative inline-flex">
      <User className="size-5" />
      <AttentionDot className="absolute -top-0.5 -right-0.5" />
    </span>
  ),
}

export const BesideLabel: Story = {
  parameters: {
    docs: {
      description: {
        story: 'After a menu row label, as on "Past meals".',
      },
    },
  },
  render: () => (
    <div className="flex items-center gap-2">
      <Body>Past meals</Body>
      <AttentionDot />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Past meals')).toBeVisible()
  },
}
