import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ShoppingSection } from './ShoppingSection'
import { WINDOW_STORAGE_KEY } from './use-shopping-window'
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
          "The shopping-list card on `/shopping`. Groups the computed list by category, urgency, or A–Z (persisted in `localStorage`), interleaves user-added custom items, and exports the still-to-buy items to the clipboard as plain text. Its header is the shared `ShoppingListHeader`, so the 7/14-day window picker is reachable with items on screen — see `Feature/Inventory/ShoppingListHeader` for the picker's own behavioural stories.",
      },
    },
  },
  // Every story mounts in category mode at the 7-day window regardless of what a
  // previously-played story persisted. Category is not the default (urgency is,
  // HON-959), so it is pinned in `localStorage`, which the section reads after
  // mount; the window key is cleared so the picker starts where the story says
  // it does.
  beforeEach: () => {
    localStorage.setItem(SORT_STORAGE_KEY, 'category')
    localStorage.removeItem(WINDOW_STORAGE_KEY)
    return () => {
      localStorage.removeItem(SORT_STORAGE_KEY)
      localStorage.removeItem(WINDOW_STORAGE_KEY)
    }
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
          'Category mode with a mix of outstanding and purchased items. Custom items linked to an ingredient render inside that ingredient\'s category group; the rest fall into "Other". One fixture item is already checked off, so this is also the crowded-header case — all four controls (`Copy list`, `Clear checked`, the sort select, the window picker) render at once. None of them can shrink, so at the default 390px viewport the row wraps rather than overflowing the card.',
      },
    },
  },
}

const ADD_FIELD = { name: 'Add custom item to shopping list' } as const

/** Asserts the empty sheet: header, Add field and the state's line, no Copy list. */
async function expectEmptySheet(canvasElement: HTMLElement, line: string) {
  const canvas = within(canvasElement)
  await expect(canvas.getByRole('heading', { name: 'Shopping list' })).toBeInTheDocument()
  const sheet = within(canvas.getByTestId('shopping-sheet'))
  await expect(sheet.getByRole('textbox', ADD_FIELD)).toBeVisible()
  await expect(sheet.getByText(line)).toBeVisible()
  await expect(canvas.queryByRole('button', { name: 'Copy list' })).not.toBeInTheDocument()
  await expect(canvas.queryByRole('link', { name: 'Generate plan' })).not.toBeInTheDocument()
}

export const NoPlan: Story = {
  args: { emptyVariant: 'no-plan', groups: [], initialCustomItems: [] },
  parameters: {
    docs: {
      description: {
        story:
          'No meal plan yet. The list keeps its header, the note sheet and the Add field, and one muted line under the field says it is empty, so a household that shops by hand can still add an item. There is no "Generate plan" button: the plan is generated on Today (HON-1354). Copy list is hidden, because nothing is left to copy.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expectEmptySheet(canvasElement, 'Your shopping list is empty.')
  },
}

export const NothingNeeded: Story = {
  args: { emptyVariant: 'nothing-needed', groups: [], initialCustomItems: [] },
  parameters: {
    docs: {
      description: {
        story:
          'A plan exists but the pantry already covers it. The line under the Add field says why the list is empty and names the window the picker shows.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expectEmptySheet(
      canvasElement,
      'Your pantry has everything you need for the next 7 days.',
    )
  },
}

export const AllPurchased: Story = {
  args: {
    groups: [{ category: 'vegetable' as const, items: produceShoppingItems }],
    initialPurchasedIds: new Set(produceShoppingItems.map((item) => item.ingredientId)),
    initialCustomItems: [],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Every item is checked off. The bought rows stay on the sheet, so a mis-tap can be undone, and the line under the Add field says the list is done. The line names no window, so it never contradicts the picker (HON-661).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expectEmptySheet(canvasElement, "You've bought everything on your list.")
  },
}

// Adding an item from an empty list puts it on the sheet at once and replaces
// the empty line. The default MSW handler answers the POST.
export const AddFromEmpty: Story = {
  args: { emptyVariant: 'no-plan', groups: [], initialCustomItems: [] },
  parameters: {
    docs: {
      description: {
        story:
          'Typing an item into the Add field of an empty list and pressing Enter puts it on the sheet without a reload; the empty line goes and Copy list appears.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', ADD_FIELD), 'Coffee{Enter}')
    const sheet = within(canvas.getByTestId('shopping-sheet'))
    await waitFor(() => expect(sheet.getByText('Coffee')).toBeVisible())
    await expect(sheet.queryByText('Your shopping list is empty.')).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Copy list' })).toBeVisible()
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

    // No success toast (HON-955): the checkmark confirms the copy, and the
    // status region voices it, since both icons are aria-hidden.
    await expect(canvas.getByRole('status')).toHaveTextContent('Shopping list copied')
  },
}
