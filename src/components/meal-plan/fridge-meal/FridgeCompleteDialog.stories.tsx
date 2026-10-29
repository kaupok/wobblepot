import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import {
  assertFocusInDialog,
  assertTabStaysInDialog,
  awaitDialogClosed,
  openViaTrigger,
  pressEscape,
} from '@/stories/a11y-helpers'
import { fridgeItems } from '@/stories/fridge-fixtures'

import { FridgeCompleteDialog } from './FridgeCompleteDialog'

const meta = {
  title: 'Meal plan/Fridge meal/FridgeCompleteDialog',
  component: FridgeCompleteDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Completing a fridge meal (HON-1277): one "Used it all" tick per pantry item, none ticked at first. A ticked item runs out in the pantry; the rest keep their quantity. Portal-based.',
      },
    },
  },
  args: {
    open: true,
    onOpenChange: fn(),
    onConfirm: fn(),
    items: fridgeItems,
  },
} satisfies Meta<typeof FridgeCompleteDialog>

export default meta
type Story = StoryObj<typeof meta>

/** The pantry items only, nothing ticked. */
export const NothingTicked: Story = {
  play: async () => {
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: 'Did you use anything up?' }),
    )
    const ticks = dialog.getAllByRole('checkbox')
    await expect(ticks).toHaveLength(2)
    for (const tick of ticks) await expect(tick).not.toBeChecked()
  },
}

export const TickCucumber: Story = {
  play: async ({ args }) => {
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: 'Did you use anything up?' }),
    )
    await userEvent.click(dialog.getByRole('checkbox', { name: 'Used it all: Cucumber' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Done' }))
    await expect(args.onConfirm).toHaveBeenCalledWith(['cucumber'])
  },
}

export const Saving: Story = {
  args: { isLoading: true },
}

export const A11yInteractionPatterns: Story = {
  args: { open: false },
  render: (args) => {
    const [open, setOpen] = useState(args.open ?? false)
    return (
      <div>
        <button type="button" data-testid="a11y-trigger" onClick={() => setOpen(true)}>
          Open dialog
        </button>
        <FridgeCompleteDialog
          {...args}
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            args.onOpenChange?.(next)
          }}
        />
      </div>
    )
  },
  play: async ({ args, canvasElement }) => {
    const trigger = within(canvasElement).getByTestId('a11y-trigger')
    await openViaTrigger(trigger)
    await assertFocusInDialog()
    await assertTabStaysInDialog()
    await pressEscape()
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false))
    await awaitDialogClosed()
  },
}
