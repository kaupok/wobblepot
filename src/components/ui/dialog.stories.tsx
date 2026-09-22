import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import {
  assertFocusInDialog,
  awaitDialogClosed,
  openViaTrigger,
  pressEscape,
} from '@/stories/a11y-helpers'
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
  // No close button, so the header reserves no room for one (HON-760).
  play: async () => {
    const body = within(document.body)
    const title = await body.findByRole('heading', { name: 'Generating plan' })
    const header = title.closest('[data-slot="dialog-header"]')
    expect(header).not.toBeNull()
    expect(window.getComputedStyle(header as Element).paddingRight).toBe('0px')
  },
}

// A title long enough to wrap must stay clear of the absolutely positioned
// close button (HON-760). Meal names are AI-generated and user-edited, so this
// is the normal case, not an edge case. Runs at the default 390px viewport;
// `LongTitleDesktop` and `LongTitleDark` cover the other width and theme.
const LONG_TITLE = 'Blood Sausage Potato Cake with Crushed Potato Chip Crust'

export const LongTitle: Story = {
  args: { open: true },
  render: (args) => (
    <Dialog {...args}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{LONG_TITLE}</DialogTitle>
          <DialogDescription>Review the matched ingredients before saving.</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  ),
  play: async () => {
    const body = within(document.body)
    const title = await body.findByRole('heading', { name: LONG_TITLE })
    const close = body.getByRole('button', { name: 'Close' })

    // A single line would pass trivially, so prove the title actually wraps.
    const lineHeight = Number.parseFloat(window.getComputedStyle(title).lineHeight)
    expect(title.getBoundingClientRect().height).toBeGreaterThan(lineHeight * 1.5)

    // Every line box of the title, not just its block, must end left of the ✕.
    const range = document.createRange()
    range.selectNodeContents(title)
    const closeLeft = close.getBoundingClientRect().left
    for (const rect of Array.from(range.getClientRects())) {
      expect(rect.right).toBeLessThanOrEqual(closeLeft)
    }
    expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(closeLeft)
  },
}

export const LongTitleDesktop: Story = {
  ...LongTitle,
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
}

export const LongTitleDark: Story = {
  ...LongTitle,
  globals: {
    theme: 'dark',
  },
}

// Asserts the house easing curve and the 200ms dialog duration (docs/DESIGN.md
// → Motion) reach the dialog and its overlay:
// `globals.css` overrides Tailwind's `--ease-out`, `DialogContent` carries the
// `ease-out` utility, and tw-animate-css reads it through `--tw-ease`, so both
// the transition and the enter keyframe run on the same curve.
export const HouseEasing: Story = {
  args: { open: false },
  render: (args) => {
    const [open, setOpen] = useState(args.open ?? false)
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)}>
          Open dialog
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>House easing</DialogTitle>
              <DialogDescription>This dialog enters on the house curve.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openViaTrigger(canvas.getByRole('button', { name: 'Open dialog' }))

    const dialog = await within(document.body).findByRole('dialog')
    await assertFocusInDialog()

    const style = window.getComputedStyle(dialog)
    expect(style.transitionTimingFunction).toBe(HOUSE_CURVE)
    expect(style.animationTimingFunction).toBe(HOUSE_CURVE)
    expect(style.animationDuration).toBe('0.2s')

    // The backdrop runs on the same 200ms curve, so it never outlasts or
    // undercuts the content it frames.
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).not.toBeNull()
    const overlayStyle = window.getComputedStyle(overlay as Element)
    expect(overlayStyle.animationTimingFunction).toBe(HOUSE_CURVE)
    expect(overlayStyle.animationDuration).toBe('0.2s')

    await pressEscape()
    await awaitDialogClosed()
  },
}

const HOUSE_CURVE = 'cubic-bezier(0.23, 1, 0.32, 1)'

// Asserts the prefers-reduced-motion override zeros the dialog's open
// animation (HON-470). Forces the Storybook reduced-motion toolbar on via
// `globals`, then verifies two things: every computed `animation-duration`
// collapses to `0.01ms` (direct proof the global CSS rule wins over the
// tw-animate-css utilities Radix stacks on DialogOverlay + DialogContent), and
// the whole open sequence completes well below the ~200ms Radix default.
export const ReducedMotion: Story = {
  args: { open: false },
  globals: {
    reducedMotion: 'on',
  },
  render: (args) => {
    const [open, setOpen] = useState(args.open ?? false)
    return (
      <div>
        <button type="button" data-testid="rm-trigger" onClick={() => setOpen(true)}>
          Open dialog
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reduced motion</DialogTitle>
              <DialogDescription>
                This dialog opens instantly when reduced motion is enabled.
              </DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByTestId('rm-trigger')

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-reduced-motion')).toBe('true')
    })

    const start = performance.now()
    await userEvent.click(trigger)
    const body = within(document.body)
    const dialog = await body.findByRole('dialog')
    const elapsed = performance.now() - start

    const durations = window
      .getComputedStyle(dialog)
      .animationDuration.split(/,\s*/)
      .filter(Boolean)
    expect(durations.length).toBeGreaterThan(0)
    for (const duration of durations) {
      expect(parseDurationMs(duration)).toBeLessThan(1)
    }

    expect(elapsed).toBeLessThan(100)
  },
}

// Parses a CSS `animation-duration` value to milliseconds. Browsers normalize
// small values (e.g. `0.01ms` becomes `1e-05s`), so compare numerically.
function parseDurationMs(value: string): number {
  const trimmed = value.trim()
  const numeric = Number.parseFloat(trimmed)
  if (Number.isNaN(numeric)) return Number.NaN
  if (trimmed.endsWith('ms')) return numeric
  if (trimmed.endsWith('s')) return numeric * 1000
  return Number.NaN
}
