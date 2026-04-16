import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Button } from './button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog'
import { Input } from './input'
import { Label } from './label'

const meta = {
  title: 'UI/Dialog',
  component: Dialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Portal-based. Toggle the theme toolbar to verify the overlay + content render correctly in dark mode.',
      },
    },
  },
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {
  args: { open: true },
  render: (args) => (
    <Dialog {...args}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit meal</DialogTitle>
          <DialogDescription>Update the name and description for this meal.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="dialog-name">Name</Label>
            <Input id="dialog-name" defaultValue="Lemon-garlic chicken" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dialog-notes">Notes</Label>
            <Input id="dialog-notes" placeholder="Optional" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

export const WithoutCloseButton: Story = {
  args: { open: true },
  render: (args) => (
    <Dialog {...args}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Generating plan</DialogTitle>
          <DialogDescription>This will take a few seconds.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled>Working…</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}
