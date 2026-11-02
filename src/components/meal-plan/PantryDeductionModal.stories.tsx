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
import {
  createPantryItem,
  lemonGarlicChickenComponents,
  lemonGarlicChickenComponentsFull,
} from '@/stories/fixtures'
import {
  fetaComponent,
  fetaPantryItem,
  HAVE_SOME_SERVINGS,
  haveSomeComponents,
  haveSomePantryItems,
  minceComponent,
  mincePantryItem,
  onionComponent,
  onionPantryItem,
  saltComponent,
  saltPantryItem,
} from '@/stories/have-some-fixtures'

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
          'Confirms which pantry items will be deducted when marking a meal as cooked — portal-based.',
      },
    },
  },
  args: {
    open: true,
    onOpenChange: fn(),
    onConfirm: fn(),
    mealName: 'Lemon-garlic roast chicken',
    components: lemonGarlicChickenComponents,
    householdServings: 4,
    pantryItems,
  },
} satisfies Meta<typeof PantryDeductionModal>

export default meta
type Story = StoryObj<typeof meta>

export const WithDeductions: Story = {}

export const SomeItemsRemoved: Story = {
  args: {
    householdServings: 8,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Doubling the serving size uses up several pantry items, so their rows read "Ran out", the pantry\'s own word.',
      },
    },
  },
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByRole('dialog', { name: 'Mark as cooked' })).toBeInTheDocument()
    await expect(body.getByText('800g → Ran out')).toBeInTheDocument()
  },
}

/**
 * The HON-1563 real case plus a known row: every "have some" row gets a "Used
 * up" / "Some left" choice, preset by `defaultCookOutcome` (HON-1564). The
 * feta shows its subtraction beside the same choice, preset at "Used up"
 * because the sum runs it out (HON-1583).
 */
export const HaveSomeRows: Story = {
  args: {
    mealName: 'Roast vegetable bowl',
    components: [...haveSomeComponents, fetaComponent],
    householdServings: HAVE_SOME_SERVINGS,
    pantryItems: [...haveSomePantryItems, fetaPantryItem],
  },
  play: async ({ args }) => {
    const body = within(document.body)
    const checkedIn = (name: string) =>
      within(body.getByRole('radiogroup', { name: `What is left: ${name}` })).getByRole('radio', {
        checked: true,
      })

    await body.findByRole('dialog', { name: 'Mark as cooked' })
    await expect(checkedIn('Pumpkin')).toHaveTextContent('Used up')
    await expect(checkedIn('Beetroot')).toHaveTextContent('Used up')
    await expect(checkedIn('Tahini')).toHaveTextContent('Some left')
    await expect(checkedIn('Lemon')).toHaveTextContent('Some left')
    await expect(body.getByText('100g → Ran out')).toBeInTheDocument()

    const tahini = body.getByRole('radiogroup', { name: 'What is left: Tahini' })
    await userEvent.click(within(tahini).getByRole('radio', { name: 'Used up' }))
    await userEvent.click(body.getByRole('button', { name: /^confirm$/i }))

    await expect(args.onConfirm).toHaveBeenCalledWith({
      // The feta is at its preset, so the server's subtraction decides it.
      usedUpIngredientIds: ['pumpkin', 'carrot', 'sweet-potato', 'beetroot', 'tahini'],
      someLeftIngredientIds: [],
      lowIngredientIds: [],
      usedUpCount: 6,
      someLeftCount: 6,
      lowCount: 0,
      stapleRows: 0,
    })
  },
}

/**
 * Known rows above and at 0 next to "have some" rows (HON-1583). The mince
 * keeps 500 g and opens at "Some left"; the feta runs out and opens at "Used
 * up". Switching each one changes its result before Confirm: the mince reads
 * "Ran out", and the feta reads "some", because the amount left is unknown.
 */
export const KnownAmountRows: Story = {
  args: {
    mealName: 'Bolognese',
    components: [minceComponent, fetaComponent, ...haveSomeComponents.slice(0, 2)],
    householdServings: HAVE_SOME_SERVINGS,
    pantryItems: [mincePantryItem, fetaPantryItem, ...haveSomePantryItems.slice(0, 2)],
  },
  play: async ({ args }) => {
    const body = within(document.body)
    const group = (name: string) => body.getByRole('radiogroup', { name: `What is left: ${name}` })
    const row = (name: string) => body.getByText(name).closest('li')!

    await body.findByRole('dialog', { name: 'Mark as cooked' })
    await expect(row('Beef mince')).toHaveTextContent('1000g → 500g')
    await expect(
      within(group('Beef mince')).getByRole('radio', { checked: true }),
    ).toHaveTextContent('Some left')
    await expect(row('Feta')).toHaveTextContent('100g → Ran out')
    await expect(within(group('Feta')).getByRole('radio', { checked: true })).toHaveTextContent(
      'Used up',
    )

    await userEvent.click(within(group('Beef mince')).getByRole('radio', { name: 'Used up' }))
    await expect(row('Beef mince')).toHaveTextContent('1000g → Ran out')
    await userEvent.click(within(group('Feta')).getByRole('radio', { name: 'Some left' }))
    await expect(row('Feta')).toHaveTextContent('100g → some')
    await userEvent.click(body.getByRole('button', { name: /^confirm$/i }))

    await expect(args.onConfirm).toHaveBeenCalledWith({
      usedUpIngredientIds: ['mince', 'pumpkin', 'carrot'],
      someLeftIngredientIds: ['feta'],
      lowIngredientIds: [],
      usedUpCount: 3,
      someLeftCount: 1,
      lowCount: 0,
      stapleRows: 0,
    })
  },
}

/**
 * A staple row, a row already running low and a known row (HON-1588). Onion
 * is a staple: it opens at "Some left" with the star and shows no amount.
 * Tahini is already low, so it opens at "Running low". Salt (a starter staple)
 * gets no row. Switching the mince to "Running low" reads "1000g → 500g,
 * running low".
 */
export const RunningLowAndStaples: Story = {
  args: {
    mealName: 'Bolognese',
    components: [
      minceComponent,
      haveSomeComponents.find((c) => c.ingredientId === 'tahini')!,
      onionComponent,
      saltComponent,
    ],
    householdServings: HAVE_SOME_SERVINGS,
    pantryItems: [
      mincePantryItem,
      { ...haveSomePantryItems.find((item) => item.ingredientId === 'tahini')!, low: true },
      onionPantryItem,
      saltPantryItem,
    ],
  },
  play: async ({ args }) => {
    const body = within(document.body)
    const group = (name: string) => body.getByRole('radiogroup', { name: `What is left: ${name}` })
    const row = (name: string) => body.getByText(name).closest('li')!
    const checkedIn = (name: string) => within(group(name)).getByRole('radio', { checked: true })

    await body.findByRole('dialog', { name: 'Mark as cooked' })
    await expect(body.getAllByRole('radiogroup')).toHaveLength(3)
    await expect(body.queryByText('Salt')).toBeNull()
    await expect(checkedIn('Onion')).toHaveTextContent('Some left')
    await expect(row('Onion')).not.toHaveTextContent('→')
    await expect(checkedIn('Tahini')).toHaveTextContent('Running low')
    await expect(row('Tahini')).toHaveTextContent('→ a little')

    await userEvent.click(within(group('Beef mince')).getByRole('radio', { name: 'Running low' }))
    await expect(row('Beef mince')).toHaveTextContent('1000g → 500g, running low')
    await userEvent.click(body.getByRole('button', { name: /^confirm$/i }))

    await expect(args.onConfirm).toHaveBeenCalledWith({
      usedUpIngredientIds: [],
      someLeftIngredientIds: [],
      lowIngredientIds: ['mince', 'tahini'],
      usedUpCount: 0,
      someLeftCount: 1,
      lowCount: 2,
      stapleRows: 1,
    })
  },
}

export const WithLiquid: Story = {
  args: {
    components: lemonGarlicChickenComponentsFull,
    pantryItems: [
      ...pantryItems,
      createPantryItem({ ingredientId: 'olive-oil', quantity: 500, isStaple: false }),
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'A liquid reads in ml: 500ml of olive oil less 60ml leaves 440ml. The pantry still stores grams, 1 g = 1 ml (HON-1054).',
      },
    },
  },
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByText('500ml → 440ml')).toBeInTheDocument()
    await expect(body.getByText('800g → 200g')).toBeInTheDocument()
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
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByRole('dialog', { name: 'Mark as cooked' })).toBeInTheDocument()
    await expect(
      body.getByText('Mark "Lemon-garlic roast chicken" as cooked? Your pantry does not change.'),
    ).toBeInTheDocument()
  },
}

export const OnlyAStaple: Story = {
  args: {
    components: [lemonGarlicChickenComponents[3]!],
    pantryItems: [pantryItems[3]!],
  },
  parameters: {
    docs: {
      description: {
        story:
          'A staple is never subtracted, so its row shows no amount and opens at "Some left" (HON-1588).',
      },
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
