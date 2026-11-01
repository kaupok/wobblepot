import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { PantrySwitch } from './PantrySwitch'

const meta = {
  title: 'Feature/Inventory/PantrySwitch',
  component: PantrySwitch,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: {
    pantryItemId: 'pantry-rice',
    name: 'Rice',
    checked: true,
    onHaveIt: fn(),
    onRanOut: fn(),
  },
  decorators: [
    (Story) => (
      <div className="flex items-center gap-1">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PantrySwitch>

export default meta
type Story = StoryObj<typeof meta>

/** On hand: "Have it", and a press reports the switch going off. */
export const HaveIt: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Have it')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('switch', { name: 'Have it: Rice' }))
    await expect(args.onRanOut).toHaveBeenCalledTimes(1)
    await expect(args.onHaveIt).not.toHaveBeenCalled()
  },
}

/** At 0: "Ran out", and a press reports the switch going on. */
export const RanOut: Story = {
  args: { checked: false },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Ran out')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('switch', { name: 'Have it: Rice' }))
    await expect(args.onHaveIt).toHaveBeenCalledTimes(1)
  },
}
