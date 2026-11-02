import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { createPantryItemData } from '@/stories/fixtures'

import { PantrySection } from './PantrySection'
import {
  ingredient,
  onHand,
  patchHandler,
  ranOut,
  staples,
  StatefulPantrySection,
} from './PantrySection.story.fixtures'

const meta = {
  title: 'Feature/Inventory/PantrySection/Running low',
  component: PantrySection,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    msw: { handlers: [patchHandler] },
    docs: {
      description: {
        component:
          'The Running low toggle on each pantry row whose switch is on (HON-1587). It sits under the name, beside the amount button, because the switch cluster has no width left at 390px. Pressed, it shows a check and the row goes on the shopping list as a line with no amount (HON-1586). A low row stays in its group. A row in Ran out has no toggle: ran out replaces low. The other states are in Feature/Inventory/PantrySection.',
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

const lowStaple = createPantryItemData({
  ingredient: ingredient('sunflower-oil', 'Sunflower oil', 'fat'),
  isStaple: true,
  low: true,
})
const lowOnHand = createPantryItemData({
  ingredient: ingredient('onion', 'Onion', 'vegetable', 'piece'),
  low: true,
})

export const LowStapleAndOnHand: Story = {
  args: { items: [lowStaple, ...staples, lowOnHand, ...onHand, ...ranOut] },
  parameters: {
    docs: {
      description: {
        story:
          'A low staple and a low On hand row, each with the toggle pressed and its check showing. Each stays in its group. The Ran out rows have no toggle.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: 'Running low: Sunflower oil' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(canvas.getByRole('button', { name: 'Running low: Onion' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(canvas.getByRole('button', { name: 'Running low: Salt' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(
      canvas.queryByRole('button', { name: 'Running low: Avocado' }),
    ).not.toBeInTheDocument()
    await expect(canvas.getByRole('heading', { level: 3, name: 'On hand 4' })).toBeInTheDocument()
  },
}

export const LowEstonianPhone: Story = {
  args: { items: [lowStaple, ...staples, lowOnHand, ...onHand] },
  globals: { locale: 'et', viewport: { value: 'mobileIphone', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story:
          'Estonian on a phone: "Vähe järel" under the name. On an On hand row "Lisa kogus" and the toggle do not fit on one line beside the switch, so the toggle wraps under the amount button and the name keeps its width. The toggle is a 32px box whose `::after` reaches 6px above and below it, so the target is 44px while the row keeps its rhythm.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole('button', { name: 'Vähe järel: Onion' })
    await expect(toggle).toHaveTextContent('Vähe järel')
    await expect(toggle.getBoundingClientRect().height).toBe(32)
    const target = getComputedStyle(toggle, '::after')
    await expect(target.top).toBe('-6px')
    await expect(target.bottom).toBe('-6px')
    // It wraps rather than run into the switch, and lines up with the amount button.
    const amount = canvas.getByRole('button', { name: 'Lisa kogus: Onion' })
    const onionSwitch = canvas.getByRole('switch', { name: 'Olemas: Onion' })
    await expect(toggle.getBoundingClientRect().right).toBeLessThan(
      onionSwitch.getBoundingClientRect().left,
    )
    await expect(toggle.getBoundingClientRect().left).toBe(amount.getBoundingClientRect().left)
  },
}

export const ToggleKeepsFocus: Story = {
  args: { items: [...staples, ...onHand] },
  parameters: {
    docs: {
      description: {
        story:
          'A tap presses the toggle and sends `{ low: true }`; a second tap clears it. The toggle stays mounted, so focus stays on it after the response.',
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole('button', { name: 'Running low: Garlic' })
    await userEvent.click(toggle)
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(args.onPantryQuantityChanged).toHaveBeenCalledTimes(1))
    await expect(toggle).toHaveFocus()
    await userEvent.keyboard(' ')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(args.onPantryQuantityChanged).toHaveBeenCalledTimes(2))
    await expect(toggle).toHaveFocus()
  },
}
