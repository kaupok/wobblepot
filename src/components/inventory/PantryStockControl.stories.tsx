import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { PantryStockControl } from './PantryStockControl'

const meta = {
  title: 'Feature/Inventory/PantryStockControl',
  component: PantryStockControl,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "The pantry row's stock state as one control, Have it · Low · Ran out (HON-1624). A `ToggleGroup` with one pressed part: a screen reader reads the group with the item's name and the pressed part as checked. The pressed part is filled and carries a check, so the state does not rest on the fill alone. A press on the pressed part changes nothing. `PantrySection` maps each part to its request; the rows are in Feature/Inventory/PantrySection.",
      },
    },
  },
  args: {
    pantryItemId: 'pantry-1',
    name: 'Garlic',
    stock: 'haveIt',
    onStockChange: fn(),
  },
} satisfies Meta<typeof PantryStockControl>

export default meta
type Story = StoryObj<typeof meta>

export const HaveIt: Story = {
  play: async ({ canvasElement, args }) => {
    const group = within(canvasElement).getByRole('radiogroup', { name: 'Stock: Garlic' })
    const haveIt = within(group).getByRole('radio', { name: 'Have it' })
    await expect(haveIt).toHaveAttribute('aria-checked', 'true')
    await expect(within(group).getByRole('radio', { name: 'Low' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    // The pressed part keeps the state: a press on it changes nothing.
    await userEvent.click(haveIt)
    await expect(args.onStockChange).not.toHaveBeenCalled()
    await userEvent.click(within(group).getByRole('radio', { name: 'Ran out' }))
    await expect(args.onStockChange).toHaveBeenCalledWith('ranOut')
  },
}

export const Low: Story = {
  args: { stock: 'low' },
}

/**
 * The `xs-touch` size (HON-1637): each part is 28px at 390px and at 1280px,
 * and its `::after` reaches 8px above and below it, so the target is 44px.
 */
export const CompactSize: Story = {
  args: { stock: 'low' },
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole('radiogroup', { name: 'Stock: Garlic' })
    for (const radio of within(group).getAllByRole('radio')) {
      await expect(radio.getBoundingClientRect().height).toBe(28)
      const target = getComputedStyle(radio, '::after')
      await expect(target.top).toBe('-8px')
      await expect(target.bottom).toBe('-8px')
    }
  },
}

export const CompactSizeDesktop: Story = {
  ...CompactSize,
  globals: { viewport: { value: 'desktop', isRotated: false } },
}

export const RanOut: Story = {
  args: { stock: 'ranOut' },
}

export const EstonianPhone: Story = {
  args: { stock: 'low', name: 'konserveeritud kooritud terved tomatid' },
  globals: { locale: 'et', viewport: { value: 'mobileIphone', isRotated: false } },
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole('radiogroup', {
      name: 'Varu: konserveeritud kooritud terved tomatid',
    })
    await expect(within(group).getByRole('radio', { name: 'Vähe' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // One line: every part shares a top.
    const tops = within(group)
      .getAllByRole('radio')
      .map((radio) => radio.getBoundingClientRect().top)
    await expect(new Set(tops).size).toBe(1)
  },
}
