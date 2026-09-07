import { describe, it, expect } from 'vitest'
import { toShoppingItemData, type ShoppingListApiItem } from './shopping-item-transform'

function apiItem(overrides: Partial<ShoppingListApiItem> = {}): ShoppingListApiItem {
  return {
    ingredientId: 'ing-1',
    name: 'Salt',
    quantity: 0,
    unit: 'g',
    displayQuantity: 'to taste',
    mealCount: 3,
    purchased: false,
    neededByDate: '2026-09-08',
    neededByRelative: 'Tomorrow',
    neededByAbsolute: 'Sep 8, 2026',
    isVague: true,
    ...overrides,
  }
}

describe('toShoppingItemData', () => {
  it('preserves isVague so a vague quantity still renders italic', () => {
    expect(toShoppingItemData(apiItem({ isVague: true })).isVague).toBe(true)
  })

  it('preserves a false isVague, leaving a computed quantity unstyled', () => {
    expect(toShoppingItemData(apiItem({ isVague: false })).isVague).toBe(false)
  })

  it('leaves isVague undefined when the API omits it', () => {
    const { isVague: _isVague, ...withoutFlag } = apiItem()

    expect(toShoppingItemData(withoutFlag).isVague).toBeUndefined()
  })

  it('drops the raw figures no client component reads', () => {
    const result = toShoppingItemData(apiItem())

    expect(result).not.toHaveProperty('quantity')
    expect(result).not.toHaveProperty('unit')
    expect(result).not.toHaveProperty('mealCount')
  })

  // Exact-object assertion, not a field-by-field check: it is what makes a
  // future field silently vanishing from the transform fail the suite (HON-631).
  it('keeps every field the shopping item renders, and nothing else', () => {
    expect(toShoppingItemData(apiItem())).toEqual({
      ingredientId: 'ing-1',
      name: 'Salt',
      displayQuantity: 'to taste',
      purchased: false,
      neededByDate: '2026-09-08',
      neededByRelative: 'Tomorrow',
      neededByAbsolute: 'Sep 8, 2026',
      isVague: true,
    })
  })
})
