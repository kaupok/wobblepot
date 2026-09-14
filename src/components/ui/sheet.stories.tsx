import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import {
  assertFocusInDialog,
  assertTabStaysInDialog,
  awaitDialogClosed,
  openViaTrigger,
  pressEscape,
} from '@/stories/a11y-helpers'
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

// Asserts the Sheet's durations and easing (docs/DESIGN.md → Motion): 300ms to
// open, 200ms to close — an exit is never slower than its enter — both on the
// house curve. The content element stays mounted with `data-state="closed"`
// while Radix's Presence waits for the exit keyframe, which is the window the
// closing duration is read in.
export const Motion: Story = {
  args: { open: false },
  render: (args) => {
    const [open, setOpen] = useState(args.open ?? false)
    return (
      <div className="p-6">
        <Button variant="outline" onClick={() => setOpen(true)}>
          Open sheet
        </Button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="right">{body}</SheetContent>
        </Sheet>
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openViaTrigger(canvas.getByRole('button', { name: 'Open sheet' }))

    const sheet = await within(document.body).findByRole('dialog')
    await assertFocusInDialog()
    await assertTabStaysInDialog()

    const opening = window.getComputedStyle(sheet)
    expect(opening.animationDuration).toBe('0.3s')
    expect(opening.animationTimingFunction).toBe('cubic-bezier(0.23, 1, 0.32, 1)')

    await pressEscape()
    await waitFor(() => expect(sheet).toHaveAttribute('data-state', 'closed'))
    expect(window.getComputedStyle(sheet).animationDuration).toBe('0.2s')

    await awaitDialogClosed()
  },
}
