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

/**
 * Every unpurchased row's quantity must end at the same x, whichever due tag
 * follows it — "Today" and "Tomorrow" differ in width (HON-762).
 */
async function expectQuantitiesAligned(canvasElement: HTMLElement) {
  const rows = within(canvasElement).getAllByRole('listitem')
  const [first, ...rest] = rows.map((row) => row.children[1]?.getBoundingClientRect().right)
  await expect(rest.length).toBeGreaterThan(0)
  for (const right of rest) await expect(right).toBeCloseTo(first ?? Number.NaN, 0)
}

export const MixedUrgency: Story = {
  args: { items: urgentShoppingItems },
  play: async ({ canvasElement }) => {
    await expectQuantitiesAligned(canvasElement)
    const today = within(canvasElement).getByText('today')
    await expect(today).toHaveClass('text-warning')
    await expect(today).not.toHaveClass('text-destructive')
  },
}

// Estonian tags ("Täna" / "Homme") measure differently from English ones; the
// quantity column has to line up in both.
export const MixedUrgencyEstonian: Story = {
  globals: { locale: 'et' },
  args: {
    items: [
      createUrgentShoppingItem({
        ingredientId: 'kanakints',
        name: 'Kanakints',
        displayQuantity: '600 g',
        neededByRelative: 'Täna',
      }),
      createUrgentShoppingItem({
        ingredientId: 'sidrun',
        name: 'Sidrun',
        displayQuantity: '2 tk',
        neededByRelative: 'Täna',
      }),
      createUrgentShoppingItem({
        ingredientId: 'lohefilee',
        name: 'Lõhefilee',
        displayQuantity: '40 g',
        neededByDate: '2026-04-16',
        neededByRelative: 'Homme',
        urgency: 'tomorrow',
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    await expectQuantitiesAligned(canvasElement)
  },
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

/**
 * The phone form that leads the Today screen below `lg` (HON-766): title row,
 * summary and link, no item list.
 */
export const Compact: Story = {
  args: { items: urgentShoppingItems, compact: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/^Need /)).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'View full list' })).toHaveAttribute(
      'href',
      '/shopping',
    )
    await expect(canvas.queryByRole('list')).not.toBeInTheDocument()
  },
}

export const CompactTomorrowOnly: Story = {
  args: { ...TomorrowOnly.args, compact: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Need 1 for tomorrow')).toBeVisible()
  },
}

// Nothing to buy for today or tomorrow: the phone shows nothing extra.
export const CompactEmpty: Story = {
  args: { items: [], compact: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText('Shopping')).not.toBeInTheDocument()
  },
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
