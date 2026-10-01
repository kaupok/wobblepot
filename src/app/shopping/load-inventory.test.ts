import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadInventory } from './load-inventory'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { loadPantry } from '@/lib/meal-planning/load-pantry'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/meal-planning/load-pantry', () => ({ loadPantry: vi.fn() }))
vi.mock('@/lib/shopping/load-shopping-list', () => ({ loadShoppingList: vi.fn() }))

const mockLoadPantry = vi.mocked(loadPantry)
const mockLoadShoppingList = vi.mocked(loadShoppingList)

const household = {
  id: 'household-123',
  locale: 'en',
  timezone: 'Europe/Tallinn',
  _count: { members: 2 },
}

const PANTRY = {
  items: [
    {
      id: 'pantry-1',
      ingredientId: 'ing-salt',
      ingredient: { id: 'ing-salt', name: 'Salt', category: 'spices', defaultUnit: 'g' },
      quantity: null,
      isStaple: true,
      updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    },
  ],
  windowDays: 7,
}

const SHOPPING_LIST = {
  windowDays: 7,
  startDate: '2026-09-29',
  endDate: '2026-10-06',
  generatedAt: '2026-09-28T10:00:00.000Z',
  hasAnyPlan: true,
  groups: [
    {
      category: 'produce',
      categoryLabel: 'Produce',
      items: [
        {
          ingredientId: 'ing-onion',
          name: 'Onion',
          quantity: 2,
          unit: 'piece',
          displayQuantity: '2',
          mealCount: 1,
          purchased: true,
          neededByDate: '2026-09-29',
          neededByRelative: 'Today',
          neededByAbsolute: 'Tue, 29 Sep',
          dueToday: true,
          isVague: false,
        },
      ],
    },
  ],
  customItems: [],
  summary: { totalItems: 1, purchasedItems: 1, remainingItems: 0 },
}

describe('loadInventory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: 'user-1' } } as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue({ household } as never)
    mockLoadPantry.mockResolvedValue(PANTRY as never)
    mockLoadShoppingList.mockResolvedValue(SHOPPING_LIST as never)
  })

  it('reads both sections for the requested window', async () => {
    const data = await loadInventory('14')

    expect(mockLoadPantry).toHaveBeenCalledWith(household, { days: 14 })
    expect(mockLoadShoppingList).toHaveBeenCalledWith(household, { days: 14 })
    expect(data.windowDays).toBe(14)
    expect(data.windowDaysFromUrl).toBe(true)
  })

  it('narrows loader data to what the sections render', async () => {
    const data = await loadInventory(undefined)

    expect(data.pantryLoadFailed).toBe(false)
    expect(data.pantryItems).toEqual([
      expect.objectContaining({ id: 'pantry-1', updatedAt: '2026-09-01T10:00:00.000Z' }),
    ])
    expect(data.pantryItems[0]).not.toHaveProperty('ingredientId')
    expect(data.emptyStateVariant).toBeFalsy()
    expect(data.shoppingData?.initialPurchasedIds).toEqual(new Set(['ing-onion']))
    expect(data.shoppingData?.groups[0]?.items[0]).not.toHaveProperty('mealCount')
  })

  it('flags a failed pantry load and still renders the shopping list', async () => {
    const error = new Error('pantry down')
    mockLoadPantry.mockRejectedValue(error)

    const data = await loadInventory(undefined)

    expect(data.pantryLoadFailed).toBe(true)
    expect(data.pantryItems).toEqual([])
    expect(data.shoppingData).not.toBeNull()
    expect(data.emptyStateVariant).toBeFalsy()
    expect(captureApiError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ section: 'pantry', householdId: 'household-123' }),
    )
  })

  it('shows the error empty state for a failed shopping list and keeps the pantry', async () => {
    const error = new Error('shopping down')
    mockLoadShoppingList.mockRejectedValue(error)

    const data = await loadInventory(undefined)

    expect(data.emptyStateVariant).toBe('error')
    expect(data.shoppingData).toBeNull()
    expect(data.pantryLoadFailed).toBe(false)
    expect(data.pantryItems).toHaveLength(1)
    expect(captureApiError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ section: 'shopping-list' }),
    )
  })

  it('redirects to sign-in without a session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    await expect(loadInventory(undefined)).rejects.toThrow('NEXT_REDIRECT:/sign-in')
  })
})
