import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog'
import { buttonVariants } from './button'
import { cn } from '@/lib/utils'

const meta = {
  title: 'UI/AlertDialog',
  component: AlertDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Portal-based confirmation dialog with no `X` close button — destructive actions go through Cancel/Action.',
      },
    },
  },
} satisfies Meta<typeof AlertDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Destructive: Story = {
  args: { open: true },
  render: (args) => (
    <AlertDialog {...args}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this meal plan?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove the plan and all 7 meals. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className={cn(buttonVariants({ variant: 'destructive' }))}>
            Delete plan
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
}

export const Default: Story = {
  args: { open: true },
  render: (args) => (
    <AlertDialog {...args}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Regenerate this week?</AlertDialogTitle>
          <AlertDialogDescription>
            Replaces the 4 unrated meals with new picks. Rated meals are preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Regenerate</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
}
