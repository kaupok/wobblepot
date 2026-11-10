import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Body } from '@/components/ui/typography'
import { createPantryItemData } from '@/stories/fixtures'

import { PantryAmountField, usePantryAmountLabel } from './PantryAmountControl'

const rice = createPantryItemData({
  ingredient: { id: 'rice', name: 'Short-grain rice', category: 'carb', defaultUnit: 'g' },
  quantity: null,
})
const milk = createPantryItemData({
  ingredient: {
    id: 'milk',
    name: 'Milk',
    category: 'dairy',
    defaultUnit: 'g',
    displayUnit: 'ml',
  },
  quantity: 1500,
})
const eggs = createPantryItemData({
  ingredient: { id: 'eggs', name: 'Eggs', category: 'protein', defaultUnit: 'piece' },
  quantity: 6,
})

// The meta line's amount, without the row around it.
function AmountLabel({ item }: { item: typeof rice }) {
  return <Body variant="caption">{usePantryAmountLabel(item) ?? 'none'}</Body>
}

const meta = {
  title: 'Feature/Inventory/PantryAmountControl',
  component: PantryAmountField,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'An On hand pantry row\'s amount (HON-1402), used by `PantryItemRow`. ⋯ → "Add amount" (or "Change amount") opens `PantryAmountField` under the row. The amount starts the row\'s meta line, in the unit the pantry shows: grams, millilitres (stored 1 ml = 1 g) or pieces. Not grouped, so "1800 g" types back as it reads. See `Feature/Inventory/PantrySection` → `EnterAmount` for the whole flow.',
      },
    },
  },
  args: { item: { ...rice, quantity: 1800 }, onSave: fn(), onCancel: fn() },
} satisfies Meta<typeof PantryAmountField>

export default meta
type Story = StoryObj<typeof meta>

export const Field: Story = {
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole('textbox', { name: 'How much do you have?' })
    await expect(field).toHaveValue('1800')
    await expect(field).toHaveFocus()
  },
}

export const SaveEmpty: Story = {
  args: { item: rice },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Save' }))
    await expect(args.onSave).toHaveBeenCalledWith(null)
  },
}

export const Grams: Story = {
  render: (args) => <AmountLabel item={args.item} />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement).toHaveTextContent('1800 g')
  },
}

export const Millilitres: Story = {
  args: { item: milk },
  render: (args) => <AmountLabel item={args.item} />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement).toHaveTextContent('1500 ml')
  },
}

export const Pieces: Story = {
  args: { item: eggs },
  render: (args) => <AmountLabel item={args.item} />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement).toHaveTextContent('6 pc')
  },
}

export const Estonian: Story = {
  args: { item: { ...rice, quantity: 1.5 } },
  globals: { locale: 'et' },
  render: (args) => <AmountLabel item={args.item} />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement).toHaveTextContent('1,5 g')
  },
}
