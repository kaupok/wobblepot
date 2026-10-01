import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  assertFocusInDialog,
  assertTabStaysInDialog,
  awaitDialogClosed,
  openViaTrigger,
  pressEscape,
} from '@/stories/a11y-helpers'
import { assertCloseTarget } from '@/stories/close-target'
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
    const overlay = document.querySelector('[data-slot="sheet-overlay"]')
    expect(overlay).not.toBeNull()
    expect(window.getComputedStyle(overlay as Element).animationDuration).toBe('0.2s')

    await pressEscape()
    await waitFor(() => expect(sheet).toHaveAttribute('data-state', 'closed'))
    expect(window.getComputedStyle(sheet).animationDuration).toBe('0.2s')

    await awaitDialogClosed()
  },
}

// The close button is a 32px target, not its 16px icon (HON-810), with the icon
// still centred 24px from the content's top and right edges. `SheetHeader`
// reserves room for it, so a title long enough to wrap ends left of it. Runs at
// the default 390px viewport, measured after the slide-in finishes.
const LONG_TITLE = 'Weeknight dinners the whole household will actually eat'

export const CloseButton: Story = {
  args: { open: false, onOpenChange: fn() },
  render: (args) => {
    const [open, setOpen] = useState(args.open ?? false)
    return (
      <div className="p-6">
        <Button variant="outline" onClick={() => setOpen(true)}>
          Open sheet
        </Button>
        <Sheet
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            args.onOpenChange?.(next)
          }}
        >
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>{LONG_TITLE}</SheetTitle>
              <SheetDescription>Pick the meals for this week.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      </div>
    )
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await openViaTrigger(canvas.getByRole('button', { name: 'Open sheet' }))

    const sheet = await within(document.body).findByRole('dialog')
    await assertFocusInDialog()
    await assertTabStaysInDialog()
    await Promise.all(sheet.getAnimations({ subtree: true }).map((a) => a.finished))

    const close = within(sheet).getByRole('button', { name: 'Close' })
    assertCloseTarget(sheet, close)

    // A single line would pass trivially, so prove the title wraps, then check
    // every line box ends left of the close button.
    const title = within(sheet).getByRole('heading', { name: LONG_TITLE })
    const lineHeight = Number.parseFloat(window.getComputedStyle(title).lineHeight)
    expect(title.getBoundingClientRect().height).toBeGreaterThan(lineHeight * 1.5)
    const range = document.createRange()
    range.selectNodeContents(title)
    const closeLeft = close.getBoundingClientRect().left
    for (const rect of Array.from(range.getClientRects())) {
      expect(rect.right).toBeLessThanOrEqual(closeLeft)
    }

    await userEvent.click(close)
    await expect(args.onOpenChange).toHaveBeenCalledWith(false)
    await awaitDialogClosed()
  },
}

// The close button's screen-reader name comes from `common.close` (HON-914).
export const CloseButtonEstonian: Story = {
  args: { open: true },
  globals: { locale: 'et' },
  render: (args) => (
    <Sheet {...args}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Menüü</SheetTitle>
          <SheetDescription>Vali selle nädala toidud.</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  ),
  play: async () => {
    const sheet = await within(document.body).findByRole('dialog')
    await expect(within(sheet).getByRole('button', { name: 'Sulge' })).toBeInTheDocument()
  },
}
