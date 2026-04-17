import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { EmptyState, type EmptyStateVariant } from './EmptyState'

const meta = {
  title: 'Feature/Shopping/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Shopping-list empty state — four variants distinguished by the cause (no plan yet, all items purchased, pantry covers the week, or fetch error). Presentational only; no callbacks.',
      },
    },
  },
} satisfies Meta<typeof EmptyState>

export default meta
type Story = StoryObj<typeof meta>

export const NoPlan: Story = {
  args: { variant: 'no-plan' },
}

export const AllPurchased: Story = {
  args: { variant: 'all-purchased' },
}

export const NothingNeeded: Story = {
  args: { variant: 'nothing-needed' },
}

export const ErrorVariant: Story = {
  name: 'Error',
  args: { variant: 'error' },
}

const ALL_VARIANTS: EmptyStateVariant[] = ['no-plan', 'all-purchased', 'nothing-needed', 'error']

export const AllVariants: Story = {
  args: { variant: 'no-plan' },
  render: () => (
    <div className="flex flex-col gap-6">
      {ALL_VARIANTS.map((variant) => (
        <EmptyState key={variant} variant={variant} />
      ))}
    </div>
  ),
}
