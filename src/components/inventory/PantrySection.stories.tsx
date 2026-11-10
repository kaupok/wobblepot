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
          'The pantry half of `/shopping`. An `InlineAddItem` search, then rows split into "Staples", "On hand" and "Ran out" (a non-staple at quantity 0). Every row has a stock control, Have it · Low · Ran out (HON-1624): on the name line in a row 28rem wide, under the meta line in a narrower one (HON-1643). Ran out sets the row to 0; Have it from Ran out sets it back to "have some". An On hand row\'s ⋯ menu has "Add amount" at "have some", or "Change amount" when it holds one; the amount starts the meta line, in the unit the pantry shows. It opens a field under the row; empty saves "have some", 0 moves the row to Ran out (HON-1402). A staple at 0 stays under Staples with Ran out pressed. Each row has a star toggle, and its ⋯ menu a Remove that takes the row out at once, with no confirmation: the toast offers Undo for 6 seconds, which posts the row back with its quantity and staple state (HON-1355). Toggles and removals update optimistically and roll back with a toast if the API call fails. On a phone it is the whole of `/pantry`; from `md` up it is the left column of both `/pantry` and `/shopping`.',
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

/** Opens a row's ⋯ menu, which Radix portals to the body, and picks an item. */
async function chooseAction(canvasElement: HTMLElement, name: string, action: string) {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: `More actions: ${name}` }),
  )
  await userEvent.click(await within(document.body).findByRole('menuitem', { name: action }))
}

/** Closes the open ⋯ menu and waits for it to leave, so the next one is alone. */
async function closeMenu() {
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(within(document.body).queryByRole('menu')).toBeNull())
}

/** The items in the open ⋯ menu. */
async function menuItems() {
  const items = await within(document.body).findAllByRole('menuitem')
  return items.map((item) => item.textContent)
}

export const Amounts: Story = {
  args: { items: withAmounts },
  parameters: {
    docs: {
      description: {
        story:
          'A phone-width row. An On hand row with an amount starts its meta line with it ("1800 g · …"). The row holds only the star and ⋯ on the name line, with no "Add amount" or Remove button; the stock control sits under the meta line, lined up with the name. ⋯ offers "Change amount" on a row with an amount, "Add amount" on one without, and only Remove on a staple. No row overflows.',
      },
    },
  },
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.queryByRole('button', { name: /^(Add amount|Remove(?! from staples))/ }),
    ).toBeNull()
    const trout = canvas.getByText('Whole trout').closest('.\\@container') as HTMLElement
    await expect(trout).toHaveTextContent('1800 g')

    // ⋯ on the name line; the control under the meta line, from the name's left edge.
    const name = canvas.getByText('Whole trout').getBoundingClientRect()
    const more = canvas.getByRole('button', { name: 'More actions: Whole trout' })
    const control = canvas.getByRole('radiogroup', { name: 'Stock: Whole trout' })
    const meta = within(trout)
      .getByText(/^1800 g/)
      .getBoundingClientRect()
    await expect(Math.abs(more.getBoundingClientRect().top - name.top)).toBeLessThan(8)
    await expect(control.getBoundingClientRect().top).toBeGreaterThanOrEqual(meta.bottom)
    await expect(Math.round(control.getBoundingClientRect().left)).toBe(Math.round(name.left))
    for (const row of canvasElement.querySelectorAll<HTMLElement>('.\\@container')) {
      await expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
    }

    await userEvent.click(more)
    await expect(await menuItems()).toEqual(['Change amount', 'Remove'])
    await closeMenu()
    await userEvent.click(canvas.getByRole('button', { name: 'More actions: Garlic' }))
    await expect(await menuItems()).toEqual(['Add amount', 'Remove'])
    await closeMenu()
    await userEvent.click(canvas.getByRole('button', { name: 'More actions: Salt' }))
    await expect(await menuItems()).toEqual(['Remove'])
    await closeMenu()
  },
}

export const WideRow: Story = {
  args: { items: withAmounts },
  decorators: [
    (Story) => (
      <div className="w-3xl">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story:
          'A desktop-width row (the pantry column is about 880px at 1280px): the stock control sits on the name line, before ⋯, so a row with a need is two lines.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trout = canvas.getByText('Whole trout').closest('.\\@container') as HTMLElement
    const name = canvas.getByText('Whole trout').getBoundingClientRect()
    const control = canvas.getByRole('radiogroup', { name: 'Stock: Whole trout' })
    const more = canvas.getByRole('button', { name: 'More actions: Whole trout' })
    const meta = within(trout)
      .getByText(/^1800 g/)
      .getBoundingClientRect()
    // The meta line starts under the name, not under the star.
    await expect(Math.round(meta.left)).toBe(Math.round(name.left))
    // Both on the name line, above the meta line; ⋯ after the control.
    await expect(control.getBoundingClientRect().bottom).toBeLessThanOrEqual(meta.top + 1)
    await expect(Math.abs(control.getBoundingClientRect().top - name.top)).toBeLessThan(8)
    await expect(more.getBoundingClientRect().left).toBeGreaterThan(
      control.getBoundingClientRect().right,
    )
    // 32px name line + 20px meta line + 24px padding: two lines. The
    // `RowGroup` divider under the row is not the row's.
    const style = getComputedStyle(trout)
    const divider = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
    await expect(Math.round(trout.getBoundingClientRect().height - divider)).toBe(76)
  },
}

export const EnterAmount: Story = {
  parameters: {
    msw: { handlers: [patchHandler] },
    docs: {
      description: {
        story:
          '⋯ → "Add amount" opens one field under the row, with the decimal keypad on a phone. Text that is not a number shows "Enter a number" and saves nothing; "1800" saves, starts the meta line with "1800 g", and puts focus back on ⋯, whose item now reads "Change amount".',
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await chooseAction(canvasElement, 'Short-grain rice', 'Add amount')
    const field = await canvas.findByRole('textbox', { name: 'How much do you have?' })
    await waitFor(() => expect(field).toHaveFocus())
    await expect(field).toHaveAttribute('inputmode', 'decimal')

    await userEvent.type(field, 'abc')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(canvas.getByRole('alert')).toHaveTextContent('Enter a number')
    await expect(args.onPantryQuantityChanged).not.toHaveBeenCalled()

    await userEvent.clear(field)
    await userEvent.type(field, '1800')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))

    const row = canvas.getByText('Short-grain rice').closest('.\\@container') as HTMLElement
    await waitFor(() => expect(row).toHaveTextContent('1800 g'))
    const more = canvas.getByRole('button', { name: 'More actions: Short-grain rice' })
    await waitFor(() => expect(more).toHaveFocus())
    await waitFor(() => expect(args.onPantryQuantityChanged).toHaveBeenCalledTimes(1))
    await userEvent.click(more)
    await expect(await menuItems()).toEqual(['Change amount', 'Remove'])
    await closeMenu()
  },
}

export const EnterAmountOpen: Story = {
  args: { items: withAmounts },
  parameters: {
    docs: {
      description: {
        story:
          'The field open on a row with an amount, from ⋯ → "Change amount": it opens on the amount, with the hint under it. Checked by axe with the error showing.',
      },
    },
  },
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await chooseAction(canvasElement, 'Whole trout', 'Change amount')
    const field = await canvas.findByRole('textbox', { name: 'How much do you have?' })
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
 * ⋯ → Remove on three rows with no dialog, then Undo the second: only Lemon
 * comes back, and focus is on its ⋯, never the page body.
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

    await chooseAction(canvasElement, 'Garlic', 'Remove')
    await expect(canvas.queryByRole('alertdialog')).not.toBeInTheDocument()
    // Focus moves to the next row's ⋯, so the next pick needs no aim.
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'More actions: Lemon' })).toHaveFocus(),
    )
    await chooseAction(canvasElement, 'Lemon', 'Remove')
    await chooseAction(canvasElement, 'Salt', 'Remove')
    await waitFor(() => expect(args.onPantryItemRemoved).toHaveBeenCalledTimes(3))
    await expect(canvas.queryByText('Garlic')).not.toBeInTheDocument()

    const lemonToast = (await page.findByText('Lemon removed from pantry')).closest('li')
    if (!lemonToast) throw new Error('expected the Lemon toast')
    await userEvent.click(within(lemonToast).getByRole('button', { name: 'Undo' }))

    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'More actions: Lemon' })).toHaveFocus(),
    )
    await expect(canvas.queryByText('Garlic')).not.toBeInTheDocument()
    await expect(canvas.queryByText('Salt')).not.toBeInTheDocument()
    await expect(args.onPantryItemRestored).toHaveBeenCalledWith('lemon')
  },
}
