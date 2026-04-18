import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
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
