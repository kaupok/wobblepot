import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import {
  createUrgentShoppingItem,
  timelineTodayDate,
  urgentShoppingItems,
} from '@/stories/fixtures'
import { UrgentShopping } from './UrgentShopping'

const meta = {
  title: 'Feature/Timeline/UrgentShopping',
  component: UrgentShopping,
  tags: ['autodocs'],
  // The fixtures' today; the later-items row counts its days from it.
  args: { todayDate: timelineTodayDate },
  parameters: { layout: 'padded' },
  // The sidebar's real width (`grid-cols-timeline`'s 320px track), so a label
  // that would overflow the column overflows here too.
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UrgentShopping>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The full panel says each day once, as a Caption label naming its list, and
 * never as a tag on the row. The label is not a heading (it would land among
 * the meal days' `h2`s). Every quantity still ends at the same x.
 */
async function expectDayGroups(canvasElement: HTMLElement, days: string[]) {
  const canvas = within(canvasElement)
  const lists = canvas.getAllByRole('list')
  await expect(lists).toHaveLength(days.length)
  for (const [i, day] of days.entries()) {
    await expect(canvas.getByRole('list', { name: day })).toBe(lists[i])
    await expect(canvas.getAllByText(day)).toHaveLength(1)
  }
  await expect(canvas.queryByRole('heading')).not.toBeInTheDocument()

  const rows = canvas.getAllByRole('listitem')
  const [first, ...rest] = rows.map((row) => row.children[1]?.getBoundingClientRect().right)
  await expect(rest.length).toBeGreaterThan(0)
  for (const right of rest) await expect(right).toBeCloseTo(first ?? Number.NaN, 0)
}

/**
 * The full panel's only link is the row that closes it, named for what is past
 * the cut and leading to the list; the title row is just the name (HON-928).
 */
async function expectContinuationRow(
  canvasElement: HTMLElement,
  name: string,
  title = 'Shopping list',
) {
  const canvas = within(canvasElement)
  const links = canvas.getAllByRole('link')
  await expect(links).toHaveLength(1)
  await expect(links[0]).toHaveAccessibleName(name)
  await expect(links[0]).toHaveAttribute('href', '/shopping')
  const box = links[0]?.getBoundingClientRect()
  await expect(box?.height).toBeGreaterThanOrEqual(44)
  // The label wraps rather than pushing the chevron out of the link's box.
  const chevron = links[0]?.querySelector('svg')?.getBoundingClientRect()
  await expect(chevron?.right).toBeLessThanOrEqual(box?.right ?? Number.NaN)
  await expect(canvas.getByText(title).parentElement?.querySelector('a')).toBeNull()
}

// Eight items after tomorrow, the last one needed on day 5 (Sunday the 19th).
const laterItems = Array.from({ length: 8 }, (_, i) =>
  createUrgentShoppingItem({
    ingredientId: `later-${i}`,
    name: ['Potato', 'Rice', 'Carrot', 'Leek', 'Butter', 'Flour', 'Eggs', 'Cream'][i],
    displayQuantity: '1 pc',
    neededByDate: i < 7 ? '2026-04-17' : '2026-04-19',
    neededByRelative: i < 7 ? 'Friday' : 'Sunday',
    urgency: 'this-week',
  }),
)

export const MixedUrgency: Story = {
  args: { items: urgentShoppingItems },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectDayGroups(canvasElement, ['Today', 'Tomorrow'])
    await expect(canvas.getByText('Shopping list')).toBeVisible()
    // Neither the "Need …" line nor the item count: the groups carry both.
    await expect(canvas.queryByText(/^Need /)).not.toBeInTheDocument()
    // The fixtures' one this-week item is past the cut.
    await expectContinuationRow(canvasElement, 'Plus 1 more for the next 5 days')
  },
}

/**
 * Three items for today and tomorrow, eight more through day 5: the list ends
 * with a row saying how much more there is and over how many days (HON-928).
 */
export const PlusMore: Story = {
  args: {
    items: [
      createUrgentShoppingItem({ ingredientId: 'chicken-thigh', name: 'Chicken thigh' }),
      createUrgentShoppingItem({ ingredientId: 'lemon', name: 'Lemon', displayQuantity: '2 pcs' }),
      createUrgentShoppingItem({
        ingredientId: 'salmon-fillet',
        name: 'Salmon fillet',
        displayQuantity: '300g',
        neededByDate: '2026-04-16',
        neededByRelative: 'tomorrow',
        urgency: 'tomorrow',
      }),
      ...laterItems,
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('listitem')).toHaveLength(3)
    await expectContinuationRow(canvasElement, 'Plus 8 more for the next 5 days')
  },
}

export const PlusMoreEstonian: Story = {
  globals: { locale: 'et' },
  args: PlusMore.args,
  play: async ({ canvasElement }) => {
    await expectContinuationRow(canvasElement, 'Ja veel 8 järgmise 5 päeva jaoks', 'Poenimekiri')
  },
}

/**
 * Nothing for today or tomorrow but eight items through day 5: the empty line,
 * then the row. "Plus" would have nothing to add to.
 */
export const LaterOnly: Story = {
  args: { items: laterItems },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Nothing on the list for today or tomorrow'),
    ).toBeVisible()
    await expectContinuationRow(canvasElement, '8 items to buy over the next 5 days')
  },
}

// The longest label: the Estonian to-buy row wraps inside the 320px column.
export const LaterOnlyEstonian: Story = {
  globals: { locale: 'et' },
  args: LaterOnly.args,
  play: async ({ canvasElement }) => {
    await expectContinuationRow(
      canvasElement,
      '8 asja osta järgmise 5 päeva jooksul',
      'Poenimekiri',
    )
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
    // Nothing past tomorrow, but the list is still the place to check these off.
    await expectContinuationRow(canvasElement, 'View full list')
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
    await expect(canvas.getByRole('list', { name: 'Tomorrow' })).toBeVisible()
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
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Nothing on the list for today or tomorrow'),
    ).toBeVisible()
  },
}

/**
 * Nothing in the window at all, which is also what an empty plan looks like: a
 * neutral muted line under the title row, with no icon (HON-923), and no row or
 * link (HON-928). The header's "Pantry & shopping" still leads to the list.
 */
export const Empty: Story = {
  args: { items: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Nothing on the list for today or tomorrow')).toBeVisible()
    await expect(canvas.queryByRole('link')).not.toBeInTheDocument()
    await expect(canvasElement.querySelector('svg')).toBeNull()
  },
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
    await expect(canvas.queryByText('Today')).not.toBeInTheDocument()
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
