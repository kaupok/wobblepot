import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { pantryCheckRows } from '@/stories/pantry-check-fixtures'

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
 * First needed first; each row with its amount, meal count and date, and one
 * Add to list. The staple carries the star.
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Enough at home?' })
    await expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    await expect(canvas.getAllByRole('img', { name: 'Staple' })).toHaveLength(1)
    await expect(list).toHaveTextContent('~20 pcs · 4 meals · Tuesday')
  },
}

/** After Add to list: the row stays as Added, with Undo, and focus is on Undo. */
export const Added: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add to list: Carrot' }))
    const undo = await canvas.findByRole('button', { name: 'Undo: Carrot' })
    await expect(undo).toHaveFocus()
    await expect(undo.closest('li')).toHaveTextContent('Added · ~20 pcs · 4 meals · Tuesday')
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
