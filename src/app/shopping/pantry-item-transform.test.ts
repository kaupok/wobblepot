import { describe, it, expect } from 'vitest'
import { toPantryItemData, type PantryApiItem } from './pantry-item-transform'

function apiItem(overrides: Partial<PantryApiItem> = {}): PantryApiItem {
  return {
    id: 'pantry-1',
    ingredientId: 'ing-1',
    ingredient: {
      id: 'ing-1',
      name: 'Salt',
      category: 'spice',
      defaultUnit: 'g',
    },
    quantity: 500,
    isStaple: true,
    updatedAt: '2026-09-15T10:00:00.000Z',
    neededQuantity: 12,
    neededDisplayQuantity: 'some',
    windowDays: 7,
    isVague: true,
    ...overrides,
  }
}

describe('toPantryItemData', () => {
  // Exact-object assertion built from the input, not a field-by-field list: a
  // field added to `PantryItemData` and the API row flows through without
  // touching this test, and one silently dropped by the transform fails it.
  it('keeps every field the pantry item renders, and strips only the API-only fields', () => {
    const { ingredientId: _ingredientId, ...expected } = apiItem()

    expect(toPantryItemData(apiItem())).toEqual(expected)
  })

  it('keeps the shape when the API sends no window fields', () => {
    const {
      neededQuantity: _neededQuantity,
      neededDisplayQuantity: _neededDisplayQuantity,
      windowDays: _windowDays,
      isVague: _isVague,
      ...withoutWindow
    } = apiItem()
    const { ingredientId: _ingredientId, ...expected } = withoutWindow

    expect(toPantryItemData(withoutWindow)).toEqual(expected)
  })

  it('keeps isVague, which the row reads, and drops the duplicated ingredientId', () => {
    const result = toPantryItemData(apiItem())

    expect(result.isVague).toBe(true)
    expect(result).not.toHaveProperty('ingredientId')
  })

  it('normalises a Date updatedAt to an ISO string', () => {
    const result = toPantryItemData(apiItem({ updatedAt: new Date('2026-09-15T10:00:00.000Z') }))

    expect(result.updatedAt).toBe('2026-09-15T10:00:00.000Z')
  })
})
