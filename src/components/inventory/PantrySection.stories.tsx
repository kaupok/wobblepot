import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { toast, Toaster } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import type { PantryItemData } from '@/components/pantry/PantryItem'
import { createPantryItemData } from '@/stories/fixtures'

import { PantrySection } from './PantrySection'
import {
  ingredient,
  onHand,
  patchHandler,
  staples,
  StatefulPantrySection,
} from './PantrySection.story.fixtures'

const meta = {
  title: 'Feature/Inventory/PantrySection',
  component: PantrySection,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The pantry half of `/shopping`. An `InlineAddItem` search, then rows split into "Staples", "On hand" and "Ran out" (a non-staple at quantity 0). Every row has a switch: on while the household has it, off at 0, with the state word ("Have it" or "Ran out") beside it. Switch-off sets the row to 0; switch-on sets it back to "have some" (HON-1535). An On hand row has an amount control: "Add amount" at "have some", or the amount it holds, in the unit the pantry shows. A tap opens a field under the row; empty saves "have some", 0 moves the row to Ran out (HON-1402). A staple at 0 stays under Staples with its switch off. Each row has a star toggle and a Remove that takes the row out at once, with no confirmation: the toast offers Undo for 6 seconds, which posts the row back with its quantity and staple state (HON-1355). Toggles and removals update optimistically and roll back with a toast if the API call fails. On a phone it is the whole of `/pantry`; from `md` up it is the left column of both `/pantry` and `/shopping`.',
      },
    },
  },
  args: {
    items: [...staples, ...onHand],
    onItemsChange: fn(),
    onPantryQuantityChanged: fn(),
    onPantryItemRemoved: fn(),
    onPantryItemRestored: fn(),
  },
  render: (args) => <StatefulPantrySection {...args} />,
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PantrySection>

export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Default: both groups present, and the count of every item on the title's baseline. Starring an on-hand item moves it into Staples.",
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const title = canvas.getByRole('heading', { level: 2, name: 'Your pantry' })
    await expect(title.parentElement).toHaveTextContent(/^Your pantry5 items$/)
    expect(canvas.getByRole('heading', { name: /^Staples/ })).toBeInTheDocument()
    expect(canvas.getByText('On hand')).toBeInTheDocument()

    const [firstStar] = canvas.getAllByRole('button', { name: /mark as staple/i })
    if (!firstStar) throw new Error('expected an on-hand row with a staple toggle')
    await userEvent.click(firstStar)

    await waitFor(() => expect(args.onItemsChange).toHaveBeenCalled())
    await waitFor(() =>
      expect(canvas.getAllByRole('button', { name: /remove from staples/i })).toHaveLength(3),
    )
  },
}

export const StaplesOnly: Story = {
  args: { items: staples },
  parameters: {
    docs: {
      description: { story: 'Only staples: the "On hand" group is not rendered.' },
    },
  },
}

export const OnHandOnly: Story = {
  args: { items: onHand },
  parameters: {
    docs: {
      description: { story: 'No staples: the "Staples" group is not rendered.' },
    },
  },
}

export const Empty: Story = {
  args: { items: [] },
  parameters: {
    docs: {
      description: {
        story:
          'Nothing in the pantry: "No items" beside the title, and the search input above one muted line.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = canvas.getByRole('heading', { level: 2, name: 'Your pantry' })
    await expect(title.parentElement).toHaveTextContent(/^Your pantryNo items$/)
    await expect(canvas.getByText(/your pantry is empty/i)).toBeInTheDocument()
  },
}

export const LoadFailed: Story = {
  args: { items: [], loadFailed: true },
  parameters: {
    docs: {
      description: {
        story:
          '`/api/pantry` failed. On a phone `/pantry` is only this card, so the error replaces the list and the add search rather than reading as an empty pantry.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent(/couldn't load your pantry/i)
    await expect(canvas.queryByText(/your pantry is empty/i)).not.toBeInTheDocument()
    // No count: the number of items is unknown.
    const title = canvas.getByRole('heading', { level: 2, name: 'Your pantry' })
    await expect(title.parentElement).toHaveTextContent(/^Your pantry$/)
  },
}

const withAmounts: PantryItemData[] = [
  ...staples,
  createPantryItemData({
    ingredient: ingredient('trout', 'Whole trout', 'protein'),
    quantity: 1800,
  }),
  ...onHand,
]

export const Amounts: Story = {
  args: { items: withAmounts },
  parameters: {
    docs: {
      description: {
        story:
          'An On hand row with an amount shows it ("1800 g"); the others read "Add amount". Staples have no amount control, because completing a meal never takes a staple off. It sits under the name, so on a phone the name keeps its width; the control is 32px with a 44px target, as the switch is, and the row does not overflow.',
      },
    },
  },
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const amount = canvas.getByRole('button', { name: 'Amount: Whole trout, 1800\u00a0g' })
    await expect(amount).toHaveTextContent('1800 g')
    await expect(canvas.getByRole('button', { name: 'Add amount: Garlic' })).toBeInTheDocument()
    await expect(canvas.getAllByRole('button', { name: /^Add amount:/ })).toHaveLength(3)
    await expect(canvas.queryByRole('button', { name: /^(Add amount|Amount): Salt/ })).toBeNull()

    await expect(Math.round(amount.getBoundingClientRect().height)).toBe(32)
    const after = getComputedStyle(amount, '::after')
    await expect(after.top).toBe('-6px')
    await expect(after.bottom).toBe('-6px')
    for (const button of canvas.getAllByRole('button', { name: /^(Add amount|Amount):/ })) {
      const row = button.closest('.p-3') as HTMLElement
      await expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
    }
  },
}

export const EnterAmount: Story = {
  parameters: {
    msw: { handlers: [patchHandler] },
    docs: {
      description: {
        story:
          '"Add amount" opens one field under the row, with the decimal keypad on a phone. Text that is not a number shows "Enter a number" and saves nothing; "1800" saves, shows "1800 g" and puts focus back on the control.',
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add amount: Short-grain rice' }))
    const field = canvas.getByRole('textbox', { name: 'How much do you have?' })
    await expect(field).toHaveFocus()
    await expect(field).toHaveAttribute('inputmode', 'decimal')

    await userEvent.type(field, 'abc')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(canvas.getByRole('alert')).toHaveTextContent('Enter a number')
    await expect(args.onPantryQuantityChanged).not.toHaveBeenCalled()

    await userEvent.clear(field)
    await userEvent.type(field, '1800')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))

    const amount = await canvas.findByRole('button', {
      name: 'Amount: Short-grain rice, 1800\u00a0g',
    })
    await waitFor(() => expect(amount).toHaveFocus())
    await waitFor(() => expect(args.onPantryQuantityChanged).toHaveBeenCalledTimes(1))
  },
}

export const EnterAmountOpen: Story = {
  args: { items: withAmounts },
  parameters: {
    docs: {
      description: {
        story:
          'The field open on a row with an amount: it opens on the amount, with the hint under it. Checked by axe with the error showing.',
      },
    },
  },
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Amount: Whole trout, 1800\u00a0g' }))
    const field = canvas.getByRole('textbox', { name: 'How much do you have?' })
    await expect(field).toHaveValue('1800')
    await expect(canvas.getByText('Leave empty if you do not know')).toBeInTheDocument()
    await userEvent.clear(field)
    await userEvent.type(field, '-1')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(canvas.getByRole('alert')).toHaveTextContent('Enter a number')
  },
}

const restoreHandler = http.post('/api/pantry', async ({ request }) => {
  const body = (await request.json()) as {
    ingredientId: string
    quantity: number | null
    isStaple: boolean
  }
  const removed = [...staples, ...onHand].find((item) => item.ingredient.id === body.ingredientId)
  return HttpResponse.json(
    {
      ...removed,
      id: `restored-${body.ingredientId}`,
      quantity: body.quantity,
      isStaple: body.isStaple,
    },
    { status: 201 },
  )
})

/**
 * Remove three rows with no dialog, then Undo the second: only Lemon comes
 * back, and focus is on its Remove, never the page body.
 */
export const RemoveAndUndo: Story = {
  parameters: {
    msw: {
      handlers: [
        restoreHandler,
        http.delete('/api/pantry/:id', () => new HttpResponse(null, { status: 204 })),
      ],
    },
  },
  // Sonner's toasts are global: earlier stories' toasts would show here too.
  beforeEach: () => {
    toast.dismiss()
  },
  render: (args) => (
    <>
      <StatefulPantrySection {...args} />
      {/* The app's toaster sits in the root layout, not in the section. */}
      <Toaster />
    </>
  ),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const page = within(document.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Remove Garlic' }))
    await expect(canvas.queryByRole('alertdialog')).not.toBeInTheDocument()
    // Focus moves to the next row's Remove, so the next click needs no aim.
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Remove Lemon' })).toHaveFocus())
    await userEvent.click(canvas.getByRole('button', { name: 'Remove Lemon' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Remove Salt' }))
    await waitFor(() => expect(args.onPantryItemRemoved).toHaveBeenCalledTimes(3))
    await expect(canvas.queryByText('Garlic')).not.toBeInTheDocument()

    const lemonToast = (await page.findByText('Lemon removed from pantry')).closest('li')
    if (!lemonToast) throw new Error('expected the Lemon toast')
    await userEvent.click(within(lemonToast).getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(canvas.getByRole('button', { name: 'Remove Lemon' })).toHaveFocus())
    await expect(canvas.queryByText('Garlic')).not.toBeInTheDocument()
    await expect(canvas.queryByText('Salt')).not.toBeInTheDocument()
    await expect(args.onPantryItemRestored).toHaveBeenCalledWith('lemon')
  },
}
