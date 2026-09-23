import { useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
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
          'The pantry half of `/shopping`. An `InlineAddItem` search, then rows split into "Staples" and "On hand", each with a star toggle and a confirm-gated remove. Toggles and removals update optimistically and roll back with a toast if the API call fails. On a phone it is the whole of `/pantry`; from `md` up it is the left column of both `/pantry` and `/shopping`.',
      },
    },
  },
  args: {
    items: [...staples, ...onHand],
    onItemsChange: fn(),
    onPantryItemRemoved: fn(),
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
        story: 'Default: both groups present. Starring an on-hand item moves it into Staples.',
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/^Staples/)).toBeInTheDocument()
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
          'Nothing in the pantry: the search input stays, above one muted line in a dashed box.',
      },
    },
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
  },
}
