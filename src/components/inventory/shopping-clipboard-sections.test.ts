import { describe, expect, it } from 'vitest'

import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'
import { URGENCY_KEYS } from '@/components/shopping/UrgencyGroup'
import type { UrgencyBucket } from '@/lib/meal-planning/dates'
import { formatShoppingListForClipboard } from '@/lib/shopping/format-clipboard'

import enMessages from '../../../messages/en.json'
import { buildClipboardSectionsFor } from './shopping-clipboard-sections'
import { buildUrgencyGroups } from './shopping-sort'

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

  // HON-1647: a staple no planned meal needs has no date, so it copies under
  // its own heading after the dated groups, not under Today.
  it('copies an undated staple under "Staples", after Today', () => {
    const urgencyLabels = {
      ...labels,
      urgency: (bucket: UrgencyBucket) => enMessages.dates.urgency[URGENCY_KEYS[bucket]],
    }
    const today = new Date().toLocaleDateString('en-CA')
    const sections = buildClipboardSectionsFor(
      {
        sortMode: 'urgency',
        alphabeticalItems: [],
        urgencyGroups: buildUrgencyGroups([
          item({
            ingredientId: 'ing-lentils',
            name: 'red lentils',
            neededByDate: null,
            neededByRelative: null,
            neededByAbsolute: null,
            restock: true,
          }),
          item({ neededByDate: today, displayQuantity: '2 pc' }),
        ]),
        undatedCustomItems: [],
        categoryGroups: [],
        linkedCustomByCategory: new Map(),
        unlinkedCustomItems: [],
      },
      urgencyLabels,
    )

    expect(formatShoppingListForClipboard('Shopping list', sections)).toBe(
      'Shopping list\n\nToday (1)\n- onion 2 pc\n\nStaples (1)\n- red lentils',
    )
  })
})
