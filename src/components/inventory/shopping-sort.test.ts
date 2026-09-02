import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'
import type { CustomItemData } from '@/components/shopping/CustomItemInput'

vi.mock('@/lib/meal-planning/dates', () => ({
  // Bucket by a marker embedded in the date string so tests stay date-independent.
  getUrgencyBucket: (date: string) => date.split('|')[1] ?? 'later',
}))

import {
  buildAlphabeticalItems,
  buildUrgencyGroups,
  getInitialSortMode,
  splitCustomItems,
  SORT_STORAGE_KEY,
} from './shopping-sort'

function item(
  name: string,
  { neededByDate = '2026-02-18|later', purchased = false } = {},
): ShoppingItemData {
  return {
    ingredientId: name.toLowerCase(),
    name,
    displayQuantity: '100 g',
    purchased,
    neededByDate,
    neededByRelative: 'Wed',
    neededByAbsolute: 'Feb 18',
  }
}

function customItem(name: string, overrides: Partial<CustomItemData> = {}): CustomItemData {
  return {
    id: `custom-${name.toLowerCase()}`,
    name,
    checked: false,
    ingredientId: null,
    ingredientCategory: null,
    createdAt: '2026-02-16T00:00:00.000Z',
    ...overrides,
  }
}

describe('getInitialSortMode', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('defaults to category with nothing stored', () => {
    expect(getInitialSortMode()).toBe('category')
  })

  it.each(['urgency', 'alphabetical'] as const)('restores a stored "%s" mode', (mode) => {
    localStorage.setItem(SORT_STORAGE_KEY, mode)
    expect(getInitialSortMode()).toBe(mode)
  })

  it('ignores an unrecognised stored value', () => {
    localStorage.setItem(SORT_STORAGE_KEY, 'by-vibes')
    expect(getInitialSortMode()).toBe('category')
  })
})

describe('buildUrgencyGroups', () => {
  it('orders buckets today → tomorrow → this-week → later and drops empty ones', () => {
    const groups = buildUrgencyGroups([
      item('Later thing', { neededByDate: '2026-03-01|later' }),
      item('Today thing', { neededByDate: '2026-02-16|today' }),
    ])

    expect(groups.map((g) => g.bucket)).toEqual(['today', 'later'])
    expect(groups[0]!.items.map((i) => i.name)).toEqual(['Today thing'])
  })

  it('sorts by needed-by date within a bucket', () => {
    const groups = buildUrgencyGroups([
      item('Later in the week', { neededByDate: '2026-02-20|this-week' }),
      item('Earlier in the week', { neededByDate: '2026-02-17|this-week' }),
    ])

    expect(groups[0]!.items.map((i) => i.name)).toEqual([
      'Earlier in the week',
      'Later in the week',
    ])
  })

  it('keeps purchased items in their date position rather than sinking them', () => {
    const groups = buildUrgencyGroups([
      item('Bought', { neededByDate: '2026-02-17|this-week', purchased: true }),
      item('Unbought', { neededByDate: '2026-02-20|this-week' }),
    ])

    expect(groups[0]!.items.map((i) => i.name)).toEqual(['Bought', 'Unbought'])
  })

  it('returns nothing for an empty list', () => {
    expect(buildUrgencyGroups([])).toEqual([])
  })
})

describe('buildAlphabeticalItems', () => {
  it('interleaves computed and custom items A–Z', () => {
    const rows = buildAlphabeticalItems([item('Carrot'), item('Apple')], [customItem('Bread')])

    expect(rows.map((r) => r.item.name)).toEqual(['Apple', 'Bread', 'Carrot'])
    expect(rows.map((r) => r.kind)).toEqual(['computed', 'custom', 'computed'])
  })

  it('sinks purchased and checked items below the rest', () => {
    const rows = buildAlphabeticalItems(
      [item('Apple', { purchased: true }), item('Carrot')],
      [customItem('Bread', { checked: true })],
    )

    expect(rows.map((r) => r.item.name)).toEqual(['Carrot', 'Apple', 'Bread'])
  })
})

describe('splitCustomItems', () => {
  it('groups items with a category and collects the rest as unlinked', () => {
    const { linkedCustomByCategory, unlinkedCustomItems } = splitCustomItems([
      customItem('Kale', { ingredientCategory: 'vegetable' }),
      customItem('Napkins'),
      customItem('Leek', { ingredientCategory: 'vegetable' }),
      customItem('Beef', { ingredientCategory: 'protein' }),
    ])

    expect(linkedCustomByCategory.get('vegetable')?.map((i) => i.name)).toEqual(['Kale', 'Leek'])
    expect(linkedCustomByCategory.get('protein')?.map((i) => i.name)).toEqual(['Beef'])
    expect(unlinkedCustomItems.map((i) => i.name)).toEqual(['Napkins'])
  })

  it('returns empty collections for no custom items', () => {
    const { linkedCustomByCategory, unlinkedCustomItems } = splitCustomItems([])

    expect(linkedCustomByCategory.size).toBe(0)
    expect(unlinkedCustomItems).toEqual([])
  })
})
