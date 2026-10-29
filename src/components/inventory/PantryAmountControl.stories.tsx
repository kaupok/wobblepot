import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { createPantryItemData } from '@/stories/fixtures'

import { PantryAmountButton, PantryAmountField } from './PantryAmountControl'

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

const meta = {
  title: 'Feature/Inventory/PantryAmountControl',
  component: PantryAmountButton,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'An On hand pantry row\'s amount (HON-1402), rendered by `PantryItemRow`. The button reads "Add amount" at "have some", or the amount in the unit the pantry shows: grams, millilitres (stored 1 ml = 1 g) or pieces. Not grouped, so "1800 g" types back as it reads. A tap opens `PantryAmountField` under the row. See `Feature/Inventory/PantrySection` → `EnterAmount` for the whole flow.',
      },
    },
  },
  args: { item: rice, onClick: fn() },
} satisfies Meta<typeof PantryAmountButton>

export default meta
type Story = StoryObj<typeof meta>

export const AddAmount: Story = {
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole('button', {
      name: 'Add amount: Short-grain rice',
    })
    await userEvent.click(button)
    await expect(args.onClick).toHaveBeenCalledTimes(1)
  },
}

export const Grams: Story = {
  args: { item: { ...rice, quantity: 1800 } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button')).toHaveTextContent('1800 g')
  },
}

export const Millilitres: Story = {
  args: { item: milk },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button')).toHaveTextContent('1500 ml')
  },
}

export const Pieces: Story = {
  args: { item: eggs },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button')).toHaveTextContent('6 pc')
  },
}

export const Estonian: Story = {
  args: { item: { ...rice, quantity: 1.5 } },
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button')).toHaveTextContent('1,5 g')
  },
}

export const Field: Story = {
  render: () => (
    <PantryAmountField item={{ ...rice, quantity: 1800 }} onSave={fn()} onCancel={fn()} />
  ),
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole('textbox', { name: 'How much do you have?' })
    await expect(field).toHaveValue('1800')
    await expect(field).toHaveFocus()
  },
}
