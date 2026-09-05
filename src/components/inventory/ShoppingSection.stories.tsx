import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ShoppingSection } from './ShoppingSection'
import { formatDateRange } from '@/lib/i18n/format-dates'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import {
  customShoppingItems,
  dairyShoppingItems,
  produceShoppingItems,
  proteinShoppingItems,
} from '@/stories/fixtures'

const SORT_STORAGE_KEY = 'shopping-list-sort-mode'

const START_DATE = '2026-04-17'
const END_DATE = '2026-04-23'

// WHY: Purchased and checked-off rows intentionally render dimmer text to
// reinforce their inactive state — the checkbox and strikethrough already carry
// the status, and WCAG 1.4.3 exempts text in inactive UI components. Same narrow
// waiver the ShoppingItem / CategoryGroup / Scenarios stories use.
const inactiveStateA11y = {
  config: { rules: [{ id: 'color-contrast', enabled: false }] },
}

const CATEGORY_GROUPS = [
  { category: 'protein' as const, items: proteinShoppingItems },
  { category: 'vegetable' as const, items: produceShoppingItems },
  { category: 'dairy' as const, items: dairyShoppingItems },
]

/** The fixtures mark some rows purchased; `ShoppingSection` takes that as a prop. */
const purchasedIds = new Set(
  CATEGORY_GROUPS.flatMap((group) => group.items)
    .filter((item) => item.purchased)
    .map((item) => item.ingredientId),
)

const meta = {
  title: 'Feature/Inventory/ShoppingSection',
  component: ShoppingSection,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    a11y: inactiveStateA11y,
    docs: {
      description: {
        component:
          'The shopping-list card on `/shopping`. Groups the computed list by category, urgency, or A–Z (persisted in `localStorage`), interleaves user-added custom items, and exports the still-to-buy items to the clipboard as plain text.',
      },
    },
  },
  // Every story mounts in category mode regardless of what a previously-played
  // story persisted — the sort mode is read from `localStorage` on mount.
  beforeEach: () => {
    localStorage.setItem(SORT_STORAGE_KEY, 'category')
    return () => localStorage.removeItem(SORT_STORAGE_KEY)
  },
  args: {
    windowDays: 7,
    startDate: START_DATE,
    endDate: END_DATE,
    groups: CATEGORY_GROUPS,
    initialPurchasedIds: purchasedIds,
    initialCustomItems: customShoppingItems,
  },
} satisfies Meta<typeof ShoppingSection>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Category mode with a mix of outstanding and purchased items. Custom items linked to an ingredient render inside that ingredient\'s category group; the rest fall into "Other".',
      },
    },
  },
}

export const NothingToCopy: Story = {
  args: { groups: [], initialCustomItems: [] },
  parameters: {
    docs: {
      description: {
        story:
          'An empty list still renders the card and the custom-item input, but the copy button is gone — there is nothing to put on the clipboard.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /copy list/i })).not.toBeInTheDocument()
  },
}

// Behavioural contract of the copy button: the clipboard receives a plain-text
// list of only what is still to buy, grouped the way the user is looking at it,
// with every heading count derived from the copied lines rather than the
// on-screen totals (which still include purchased rows).
export const CopyList: Story = {
  args: {
    groups: [
      {
        category: 'protein',
        items: [
          {
            ingredientId: 'chicken-breast',
            name: 'Chicken breast',
            displayQuantity: '600g',
            purchased: false,
            neededByDate: '2026-04-18',
            neededByRelative: 'tomorrow',
            neededByAbsolute: 'Saturday, April 18',
          },
          {
            ingredientId: 'salmon-fillet',
            name: 'Salmon fillet',
            displayQuantity: '400g',
            purchased: true,
            neededByDate: '2026-04-19',
            neededByRelative: 'Sunday',
            neededByAbsolute: 'Sunday, April 19',
          },
        ],
      },
      {
        category: 'vegetable',
        items: [
          {
            ingredientId: 'broccoli',
            name: 'Broccoli',
            displayQuantity: '500g',
            purchased: false,
            neededByDate: '2026-04-18',
            neededByRelative: 'tomorrow',
            neededByAbsolute: 'Saturday, April 18',
          },
        ],
      },
    ],
    initialPurchasedIds: new Set(['salmon-fillet']),
    initialCustomItems: [
      {
        id: 'custom-baking-paper',
        name: 'Baking paper',
        checked: false,
        ingredientId: null,
        ingredientCategory: null,
        createdAt: '2026-04-17T10:00:00Z',
      },
      {
        id: 'custom-napkins',
        name: 'Napkins',
        checked: true,
        ingredientId: null,
        ingredientCategory: null,
        createdAt: '2026-04-17T10:00:00Z',
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Clicking "Copy list" writes the outstanding items to the clipboard. The purchased salmon and the checked-off napkins are absent, and the protein heading reads `(1)` even though two rows are on screen.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const writeText = fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /copy list/i }))

    // The date range's exact rendering is `formatDateRange`'s contract (and
    // ICU's); what this pins is that the header is built from the window's real
    // dates with the year included.
    const heading = `Shopping list · ${formatDateRange(
      parseLocalDate(START_DATE),
      parseLocalDate(END_DATE),
      'en',
      { withYear: true },
    )}`

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        [
          heading,
          '',
          '🥩 Protein (1)',
          '- Chicken breast 600g',
          '',
          '🥬 Vegetables (1)',
          '- Broccoli 500g',
          '',
          '📝 Other (1)',
          '- Baking paper',
        ].join('\n'),
      ),
    )

    // The label is constant across the icon swap, so the accessible name is
    // stable while the checkmark is showing.
    await expect(canvas.getByRole('button', { name: /copy list/i })).toBeInTheDocument()
  },
}
