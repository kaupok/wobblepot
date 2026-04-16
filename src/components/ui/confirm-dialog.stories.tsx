import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { ConfirmDialog } from './confirm-dialog'

const meta = {
  title: 'UI/ConfirmDialog',
  component: ConfirmDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Composite over `AlertDialog` — portal-based. Toggle the theme toolbar to verify dark mode.',
      },
    },
  },
  args: {
    open: true,
    onOpenChange: fn(),
    onConfirm: fn(),
  },
} satisfies Meta<typeof ConfirmDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    title: 'Regenerate this week?',
    description: 'Replaces the 4 unrated meals with new picks. Rated meals are preserved.',
    confirmLabel: 'Regenerate',
  },
}

export const Destructive: Story = {
  args: {
    title: 'Delete this meal plan?',
    description:
      'This will permanently remove the plan and all 7 meals. This action cannot be undone.',
    confirmLabel: 'Delete plan',
    variant: 'destructive',
  },
}

export const Loading: Story = {
  args: {
    title: 'Generating new plan',
    description: 'Replacing 4 unrated meals — this can take a few seconds.',
    confirmLabel: 'Regenerate',
    loadingLabel: 'Generating…',
    isLoading: true,
  },
}

export const CustomLabels: Story = {
  args: {
    title: 'Skip this meal?',
    description: 'It will be marked as skipped and excluded from the shopping list.',
    confirmLabel: 'Skip meal',
    cancelLabel: 'Keep planned',
  },
}
