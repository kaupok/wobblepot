import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { createUrgentShoppingItem, urgentShoppingItems } from '@/stories/fixtures'
import { UrgentShopping } from './UrgentShopping'

const meta = {
  title: 'Feature/Timeline/UrgentShopping',
  component: UrgentShopping,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UrgentShopping>

export default meta
type Story = StoryObj<typeof meta>

export const MixedUrgency: Story = {
  args: { items: urgentShoppingItems },
}

export const TodayOnly: Story = {
  args: {
    items: [
      createUrgentShoppingItem({
        ingredientId: 'chicken-thigh',
        name: 'Chicken thigh',
        displayQuantity: '600g',
      }),
      createUrgentShoppingItem({
        ingredientId: 'lemon',
        name: 'Lemon',
        displayQuantity: '2 pcs',
      }),
    ],
  },
}

export const TomorrowOnly: Story = {
  args: {
    items: [
      createUrgentShoppingItem({
        ingredientId: 'salmon-fillet',
        name: 'Salmon fillet',
        displayQuantity: '300g',
        neededByDate: '2026-04-16',
        neededByRelative: 'tomorrow',
        urgency: 'tomorrow',
      }),
    ],
  },
}

export const AllDone: Story = {
  args: {
    items: [
      createUrgentShoppingItem({
        ingredientId: 'chicken-thigh',
        name: 'Chicken thigh',
        displayQuantity: '600g',
        purchased: true,
      }),
    ],
  },
}

export const Empty: Story = {
  args: { items: [] },
}

// WHY: Purchased list items render dimmer text by design — WCAG 1.4.3 exempts
// inactive controls from contrast requirements, so waive only this rule.
const inactiveStateA11y = {
  config: { rules: [{ id: 'color-contrast', enabled: false }] },
}

// Expanded-purchased story verifies the toggle actually reveals the purchased
// list — presentational but the toggle is the one piece of interactive state
// on the sidebar.
export const ExpandedPurchased: Story = {
  args: {
    items: [
      createUrgentShoppingItem({
        ingredientId: 'chicken-thigh',
        name: 'Chicken thigh',
        displayQuantity: '600g',
      }),
      createUrgentShoppingItem({
        ingredientId: 'onion',
        name: 'Onion',
        displayQuantity: '2 pcs',
        purchased: true,
      }),
    ],
  },
  parameters: { a11y: inactiveStateA11y },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole('button', { name: /1 item purchased/i })
    await userEvent.click(toggle)
    await expect(canvas.getByText('Onion')).toBeVisible()
  },
}
