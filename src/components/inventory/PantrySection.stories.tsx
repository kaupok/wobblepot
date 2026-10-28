import { useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { http, HttpResponse } from 'msw'
import { toast, Toaster } from 'sonner'
import type { PantryItemData } from '@/components/pantry/PantryItem'
import { createPantryItemData } from '@/stories/fixtures'
import { PantrySection } from './PantrySection'

type Ingredient = PantryItemData['ingredient']

const ingredient = (
  id: string,
  name: string,
  category: Ingredient['category'],
  defaultUnit: Ingredient['defaultUnit'] = 'g',
): Ingredient => ({ id, name, category, defaultUnit })

const staples: PantryItemData[] = [
  createPantryItemData({ ingredient: ingredient('olive-oil', 'Olive oil', 'fat'), isStaple: true }),
  createPantryItemData({ ingredient: ingredient('salt', 'Salt', 'condiment'), isStaple: true }),
]

const onHand: PantryItemData[] = [
  createPantryItemData({ ingredient: ingredient('garlic', 'Garlic', 'vegetable', 'piece') }),
  createPantryItemData({ ingredient: ingredient('lemon', 'Lemon', 'fruit', 'piece') }),
  createPantryItemData({ ingredient: ingredient('short-grain-rice', 'Short-grain rice', 'carb') }),
]

// Quantity 0 is "ran out" (docs/PROJECT_SPEC.md → Pantry Quantity Semantics),
// as the fridge meal's "Used it all" leaves a row.
const ranOut: PantryItemData[] = [
  createPantryItemData({
    ingredient: ingredient('avocado', 'Avocado', 'fruit', 'piece'),
    quantity: 0,
  }),
  createPantryItemData({ ingredient: ingredient('lime', 'Lime', 'fruit', 'piece'), quantity: 0 }),
]

/**
 * `PantrySection` is controlled — `InventoryPage` owns the list and passes its
 * `setState` as `onItemsChange`. Holding the list here lets a star toggle or a
 * removal actually move the row, while the spy still records each call.
 */
function StatefulPantrySection({
  items: initialItems,
  onItemsChange,
  ...props
}: ComponentProps<typeof PantrySection>) {
  const [items, setItems] = useState(initialItems)
  return (
    <PantrySection
      {...props}
      items={items}
      onItemsChange={(update) => {
        onItemsChange(update)
        setItems(update)
      }}
    />
  )
}

const meta = {
  title: 'Feature/Inventory/PantrySection',
  component: PantrySection,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The pantry half of `/shopping`. An `InlineAddItem` search, then rows split into "Staples", "On hand" and "Ran out" (a non-staple at quantity 0, with a "Have it" that sets it back to "have some"), each with a star toggle and a Remove that takes the row out at once, with no confirmation: the toast offers Undo for 6 seconds, which posts the row back with its quantity and staple state (HON-1355). Toggles and removals update optimistically and roll back with a toast if the API call fails. On a phone it is the whole of `/pantry`; from `md` up it is the left column of both `/pantry` and `/shopping`.',
      },
    },
  },
  args: {
    items: [...staples, ...onHand],
    onItemsChange: fn(),
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

export const RanOut: Story = {
  args: { items: [...staples, ...onHand, ...ranOut] },
  parameters: {
    docs: {
      description: {
        story:
          'Two rows at quantity 0 under "Ran out", after "On hand". "Have it" moves the row back to On hand and focuses the next "Have it", so focus never falls to the page.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 3, name: 'Ran out 2' })).toBeInTheDocument()
    await expect(canvas.getByRole('heading', { level: 3, name: 'On hand 3' })).toBeInTheDocument()

    await userEvent.click(canvas.getByRole('button', { name: 'Have it: Avocado' }))

    await waitFor(() =>
      expect(canvas.getByRole('heading', { level: 3, name: 'On hand 4' })).toBeInTheDocument(),
    )
    await expect(canvas.getByRole('heading', { level: 3, name: 'Ran out 1' })).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Have it: Lime' })).toHaveFocus()
  },
}

export const RanOutEstonian: Story = {
  args: { items: [...staples, ...onHand, ...ranOut] },
  globals: { locale: 'et' },
  parameters: {
    docs: {
      description: {
        story:
          'The Ran out group in Estonian: "Otsas" over the rows, "Olemas" on each button. Checks that the longer labels fit the row.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 3, name: 'Otsas 2' })).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Olemas: Avocado' })).toBeVisible()
  },
}

/** Answers the Undo's POST with the posted row, named from the story's items. */
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
