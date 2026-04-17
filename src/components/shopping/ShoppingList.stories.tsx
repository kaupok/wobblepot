import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { http, HttpResponse } from 'msw'
import { defaultHandlers } from '@/stories/msw-handlers'
import { proteinShoppingItems, produceShoppingItems, shoppingListGroups } from '@/stories/fixtures'
import { ShoppingList } from './ShoppingList'

// WHY: Purchased items in the list intentionally render dimmer text to
// reinforce their inactive state. The checkbox + strikethrough already
// communicate completion — WCAG 1.4.3 exempts inactive UI components.
const inactiveStateA11y = {
  config: { rules: [{ id: 'color-contrast', enabled: false }] },
}

const meta = {
  title: 'Feature/Shopping/ShoppingList',
  component: ShoppingList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Top-level shopping list — renders category groups with a summary bar, and PATCHes purchase state optimistically via MSW-backed endpoints.',
      },
    },
  },
  args: {
    planId: 'plan-1',
    planStartDate: '2026-04-20',
    planEndDate: '2026-04-26',
    groups: shoppingListGroups,
    initialPurchasedIds: new Set<string>(['salmon-fillet', 'butter', 'milk']),
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ShoppingList>

export default meta
type Story = StoryObj<typeof meta>

export const PopulatedGroupedByCategory: Story = {
  parameters: { a11y: inactiveStateA11y },
}

export const Empty: Story = {
  name: 'Empty (no groups)',
  args: {
    groups: [],
    initialPurchasedIds: new Set<string>(),
  },
  parameters: {
    docs: {
      description: {
        story: 'No groups passed — summary bar reads `0 items`, category list is empty.',
      },
    },
  },
}

export const SingleCategory: Story = {
  args: {
    groups: [{ category: 'protein', categoryLabel: 'Protein', items: proteinShoppingItems }],
    initialPurchasedIds: new Set<string>(),
  },
}

export const MultipleCategories: Story = {
  args: {
    groups: [
      {
        category: 'vegetable',
        categoryLabel: 'Vegetable',
        items: produceShoppingItems,
      },
      { category: 'protein', categoryLabel: 'Protein', items: proteinShoppingItems },
    ],
    initialPurchasedIds: new Set<string>(['salmon-fillet']),
  },
  parameters: {
    a11y: inactiveStateA11y,
    docs: {
      description: {
        story:
          'Two category groups rendered together with mixed purchased state. For user-added custom items see `CategoryGroup > WithCustomItems` — `ShoppingList` does not thread custom items at the list level.',
      },
    },
  },
}

export const ErrorState: Story = {
  name: 'Error (mutation 500)',
  args: {
    groups: shoppingListGroups,
    initialPurchasedIds: new Set<string>(),
  },
  parameters: {
    msw: {
      handlers: [
        ...defaultHandlers,
        http.post('/api/meal-plans/:planId/shopping-list/purchase', () =>
          HttpResponse.json({ error: 'Failed to update item' }, { status: 500 }),
        ),
      ],
    },
    docs: {
      description: {
        story:
          'Checking an item fires the optimistic update, then rolls back when the PATCH returns 500. Sonner toast (out-of-canvas) surfaces the error.',
      },
    },
  },
}

// Play story — exercises the optimistic mutation + MSW POST handler. The
// click flips the item into its purchased state, so the inactive-state
// contrast waiver applies.
export const ChecksOffItem: Story = {
  args: {
    groups: [{ category: 'protein', categoryLabel: 'Protein', items: proteinShoppingItems }],
    initialPurchasedIds: new Set<string>(),
  },
  parameters: { a11y: inactiveStateA11y },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const chickenCheckbox = await canvas.findByRole('checkbox', {
      name: /Mark Chicken thigh as purchased/i,
    })
    await userEvent.click(chickenCheckbox)

    // Optimistic update flips the checkbox + updates the summary line.
    await waitFor(() =>
      expect(
        canvas.getByRole('checkbox', {
          name: /Mark Chicken thigh as not purchased/i,
        }),
      ).toBeChecked(),
    )
  },
}
