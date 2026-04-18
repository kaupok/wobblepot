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
import { createPantryItem, lemonGarlicChickenComponents } from '@/stories/fixtures'
import { PantryDeductionModal } from './PantryDeductionModal'

const pantryItems = [
  createPantryItem({ ingredientId: 'chicken-thigh', quantity: 800, isStaple: false }),
  createPantryItem({ ingredientId: 'potato', quantity: 500, isStaple: false }),
  createPantryItem({ ingredientId: 'lemon', quantity: 1, isStaple: false }),
  createPantryItem({ ingredientId: 'garlic', quantity: 10, isStaple: true }),
]

const meta = {
  title: 'Meal plan/PantryDeductionModal',
  component: PantryDeductionModal,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Confirms which pantry items will be deducted when marking a meal as completed — portal-based.',
      },
    },
  },
  args: {
    open: true,
    onOpenChange: fn(),
    onConfirm: fn(),
    mealName: 'Lemon-garlic roast chicken',
    components: lemonGarlicChickenComponents,
    householdSize: 4,
    pantryItems,
  },
} satisfies Meta<typeof PantryDeductionModal>

export default meta
type Story = StoryObj<typeof meta>

export const WithDeductions: Story = {}

export const SomeItemsRemoved: Story = {
  args: {
    householdSize: 8,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Doubling the serving size exhausts several pantry items — they’ll be removed after.',
      },
    },
  },
}

export const NoDeductions: Story = {
  args: {
    pantryItems: [],
  },
  parameters: {
    docs: {
      description: {
        story: 'Empty pantry — nothing will be deducted, modal asks for simple confirmation.',
      },
    },
  },
}

export const OnlyStaples: Story = {
  args: {
    components: [lemonGarlicChickenComponents[3]!],
    pantryItems: [pantryItems[3]!],
  },
  parameters: {
    docs: {
      description: { story: 'Staples are never deducted, so the list is empty.' },
    },
  },
}

export const Loading: Story = {
  args: {
    isLoading: true,
  },
}

// Play stories — Radix Dialog portals outside `canvasElement`, so queries use
// `within(document.body)`. The modal is read-only aside from the two footer
// buttons, so these cover the full parent-callback contract.

export const ConfirmInvokesCallback: Story = {
  play: async ({ args }) => {
    const body = within(document.body)
    // Assert computed deductions render (3 non-staple items, garlic is skipped)
    await body.findByText('Chicken thigh')
    await body.findByText('Potato')
    await body.findByText('Lemon')

    const confirmButton = await body.findByRole('button', { name: /^confirm$/i })
    await userEvent.click(confirmButton)

    await expect(args.onConfirm).toHaveBeenCalledTimes(1)
  },
}

export const CancelClosesDialog: Story = {
  play: async ({ args }) => {
    const body = within(document.body)
    const cancelButton = await body.findByRole('button', { name: /^cancel$/i })
    await userEvent.click(cancelButton)

    await expect(args.onOpenChange).toHaveBeenCalledWith(false)
  },
}

// Interaction-a11y story — focus trap / tab containment / Escape / close-
// sequence completion. See `src/stories/a11y-helpers.ts`.
export const A11yInteractionPatterns: Story = {
  args: { open: false },
  render: (args) => {
    const [open, setOpen] = useState(args.open ?? false)
    return (
      <div>
        <button type="button" data-testid="a11y-trigger" onClick={() => setOpen(true)}>
          Open modal
        </button>
        <PantryDeductionModal
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
    const canvas = within(canvasElement)
    const trigger = canvas.getByTestId('a11y-trigger')

    await openViaTrigger(trigger)
    await assertFocusInDialog()
    await assertTabStaysInDialog()

    await pressEscape()
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false))
    await awaitDialogClosed()
  },
}
