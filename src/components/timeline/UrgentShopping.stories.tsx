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
 * The full panel says each day once, as a Caption heading over its items, and
 * never as a tag on the row. Every quantity still ends at the same x.
 */
async function expectDayGroups(canvasElement: HTMLElement, days: string[]) {
  const canvas = within(canvasElement)
  const headings = canvas.getAllByRole('heading', { level: 3 })
  await expect(headings.map((h) => h.textContent)).toEqual(days)
  for (const day of days) await expect(canvas.getAllByText(day)).toHaveLength(1)

  const rows = canvas.getAllByRole('listitem')
  const [first, ...rest] = rows.map((row) => row.children[1]?.getBoundingClientRect().right)
  await expect(rest.length).toBeGreaterThan(0)
  for (const right of rest) await expect(right).toBeCloseTo(first ?? Number.NaN, 0)
}

export const MixedUrgency: Story = {
  args: { items: urgentShoppingItems },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectDayGroups(canvasElement, ['Today', 'Tomorrow'])
    await expect(canvas.getByText('Shopping list')).toBeVisible()
    // Neither the "Need …" line nor the item count: the groups carry both.
    await expect(canvas.queryByText(/^Need /)).not.toBeInTheDocument()
  },
}

// The day headings come from the `dates.urgency` catalog, so the Estonian
// panel groups under "Täna" / "Homme".
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
    await expectDayGroups(canvasElement, ['Täna', 'Homme'])
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
  play: async ({ canvasElement }) => {
    await expectDayGroups(canvasElement, ['Today'])
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 3 })).toHaveTextContent('Tomorrow')
    await expect(canvas.queryByText('Today')).not.toBeInTheDocument()
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
 * The phone form that leads the Today screen below `lg` (HON-766): title row
 * with the link, the "Need …" summary, no item list and no item count.
 */
export const Compact: Story = {
  args: { items: urgentShoppingItems, compact: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Need 1 for today, 1 for tomorrow')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'View full list' })).toHaveAttribute(
      'href',
      '/shopping',
    )
    await expect(canvas.queryByRole('list')).not.toBeInTheDocument()
    await expect(canvas.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
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
    await expect(within(canvasElement).queryByText('Shopping list')).not.toBeInTheDocument()
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
