import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Button } from './button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from './sheet'

const meta = {
  title: 'UI/Sheet',
  component: Sheet,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Portal-based slide-over. Toggle the theme toolbar to verify the overlay + content in dark mode.',
      },
    },
  },
} satisfies Meta<typeof Sheet>

export default meta
type Story = StoryObj<typeof meta>

const body = (
  <>
    <SheetHeader>
      <SheetTitle>Filters</SheetTitle>
      <SheetDescription>Narrow the meal list by tag, time, or pantry overlap.</SheetDescription>
    </SheetHeader>
    <div className="grid gap-4 px-4 text-sm">
      <p>Sheet body content goes here.</p>
      <p className="text-muted-foreground">Use the close button or click outside to dismiss.</p>
    </div>
    <SheetFooter>
      <SheetClose asChild>
        <Button variant="outline">Cancel</Button>
      </SheetClose>
      <Button>Apply</Button>
    </SheetFooter>
  </>
)

export const Right: Story = {
  args: { open: true },
  render: (args) => (
    <Sheet {...args}>
      <SheetContent side="right">{body}</SheetContent>
    </Sheet>
  ),
}

export const Left: Story = {
  args: { open: true },
  render: (args) => (
    <Sheet {...args}>
      <SheetContent side="left">{body}</SheetContent>
    </Sheet>
  ),
}

export const Top: Story = {
  args: { open: true },
  render: (args) => (
    <Sheet {...args}>
      <SheetContent side="top">{body}</SheetContent>
    </Sheet>
  ),
}

export const Bottom: Story = {
  args: { open: true },
  render: (args) => (
    <Sheet {...args}>
      <SheetContent side="bottom">{body}</SheetContent>
    </Sheet>
  ),
}
