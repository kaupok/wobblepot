import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { pantryCheckRows, pantryCheckRowsMarked } from '@/stories/pantry-check-fixtures'

import { PantryCheckList } from './PantryCheckList'

const meta = {
  title: 'Feature/Inventory/PantryCheckList',
  component: PantryCheckList,
  tags: ['autodocs'],
  args: { items: pantryCheckRows },
  parameters: { layout: 'padded' },
  // The Today sidebar's width, the narrower of the two places it renders.
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PantryCheckList>

export default meta
type Story = StoryObj<typeof meta>

/**
 * First needed first; each row on three lines: the name, its amount, meal
 * count and date, and the pantry's stock control. The staple carries the star.
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Enough at home?' })
    await expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    await expect(canvas.getAllByRole('img', { name: 'Staple' })).toHaveLength(1)
    await expect(list).toHaveTextContent('~20 pcs · 4 meals · Tuesday')
    await expect(canvas.getAllByRole('radiogroup', { name: /^Stock: / })).toHaveLength(3)
  },
}

/** Rows the household marked low and ran out show that part pressed (HON-1638). */
export const Marked: Story = {
  args: { items: pantryCheckRowsMarked },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const pressed = (name: string) =>
      within(canvas.getByRole('radiogroup', { name: `Stock: ${name}` })).getByRole('radio', {
        checked: true,
      })
    await expect(pressed('Carrot')).toHaveAccessibleName('Low')
    await expect(pressed('Basil')).toHaveAccessibleName('Ran out')
  },
}

/** A press changes the pressed part at once, and focus stays on it. */
export const Pressed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const low = within(canvas.getByRole('radiogroup', { name: 'Stock: Carrot' })).getByRole(
      'radio',
      { name: 'Low' },
    )
    await userEvent.click(low)
    await expect(low).toHaveAttribute('aria-checked', 'true')
    await expect(low).toHaveFocus()
  },
}

/** An empty check renders nothing: no heading, no list. */
export const Empty: Story = {
  args: { items: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText('Enough at home?')).not.toBeInTheDocument()
  },
}
