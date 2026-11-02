import { describe, expect, it } from 'vitest'

import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'
import { formatShoppingListForClipboard } from '@/lib/shopping/format-clipboard'

import { buildClipboardSectionsFor } from './shopping-clipboard-sections'

const labels = {
  customItems: (count: number) => `Custom items (${count})`,
  other: (count: number) => `Other (${count})`,
  urgency: (bucket: string) => bucket,
  category: (category: string) => category,
}

const item = (overrides: Partial<ShoppingItemData>): ShoppingItemData => ({
  ingredientId: 'ing-1',
  name: 'onion',
  displayQuantity: '',
  purchased: false,
  neededByDate: '2026-11-03',
  neededByRelative: 'tomorrow',
  neededByAbsolute: 'Nov 3',
  ...overrides,
})

const copy = (items: ShoppingItemData[]) =>
  formatShoppingListForClipboard(
    'Shopping list',
    buildClipboardSectionsFor(
      {
        sortMode: 'alphabetical',
        alphabeticalItems: items.map((entry) => ({ kind: 'computed' as const, item: entry })),
        urgencyGroups: [],
        undatedCustomItems: [],
        categoryGroups: [],
        linkedCustomByCategory: new Map(),
        unlinkedCustomItems: [],
      },
      labels,
    ),
  )

describe('buildClipboardSectionsFor', () => {
  // A running-low line with no amount (HON-1586) copies as the name alone,
  // as a ran-out staple does (HON-1587).
  it('copies a low line with no amount as the name alone', () => {
    expect(copy([item({ low: true })])).toBe('Shopping list\n\n- onion')
  })

  it('copies a low line with a shortfall as name and amount', () => {
    expect(copy([item({ low: true, displayQuantity: '200 g' })])).toBe(
      'Shopping list\n\n- onion 200 g',
    )
  })
})
