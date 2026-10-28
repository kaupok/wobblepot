import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
}))
vi.mock('@/lib/shopping/load-shopping-list', () => ({ loadShoppingList: vi.fn() }))

import { loadShoppingList, type ShoppingListResult } from '@/lib/shopping/load-shopping-list'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'
import { NO_HOUSEHOLD_MESSAGE, runTool } from '@/lib/mcp/context'
import { getShoppingList } from './get-shopping-list'

const household = mcpHousehold({ id: 'household-1' })
const ctx = { userId: 'user-1', household, scopes: READ_SCOPES }

const LIST = {
  windowDays: 7,
  groups: [
    {
      category: 'vegetable',
      categoryLabel: 'Vegetables',
      items: [
        {
          ingredientId: 'ing-carrot',
          name: 'Carrot',
          quantity: 300,
          unit: 'g',
          displayUnit: 'g',
          displayQuantity: '300g',
          neededByDate: '2026-10-13',
          purchased: false,
          restock: false,
        },
      ],
    },
    {
      category: 'dairy',
      categoryLabel: 'Dairy',
      items: [
        {
          ingredientId: 'ing-milk',
          name: 'Milk',
          quantity: 1000,
          unit: 'g',
          displayUnit: 'ml',
          displayQuantity: '1l',
          neededByDate: '2026-10-12',
          purchased: true,
          restock: false,
        },
        {
          ingredientId: 'ing-yoghurt',
          name: 'Greek yoghurt',
          quantity: 0,
          unit: 'g',
          displayUnit: 'g',
          displayQuantity: '',
          neededByDate: '2026-10-12',
          purchased: false,
          restock: true,
        },
      ],
    },
  ],
  customItems: [
    { id: 'custom-1', name: 'Candles', checked: false, ingredientId: null, neededBy: null },
    { id: 'custom-2', name: 'chips', checked: false, ingredientId: null, neededBy: '2026-10-14' },
  ],
} as unknown as ShoppingListResult

function call(input: Record<string, unknown> = {}) {
  return runTool(getShoppingList, ctx, getShoppingList.inputSchema.parse(input))
}

describe('get_shopping_list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadShoppingList).mockResolvedValue(LIST)
  })

  it('flattens the groups into items with their category and shown unit, for 7 days by default', async () => {
    const result = await call()

    expect(loadShoppingList).toHaveBeenCalledWith(household, { days: 7 })
    expect(result.structuredContent).toEqual({
      days: 7,
      items: [
        {
          ingredientId: 'ing-carrot',
          name: 'Carrot',
          quantity: 300,
          unit: 'g',
          displayQuantity: '300g',
          category: 'vegetable',
          neededBy: '2026-10-13',
          purchased: false,
          restock: false,
        },
        {
          ingredientId: 'ing-milk',
          name: 'Milk',
          quantity: 1000,
          // Stored as grams, shown and returned as millilitres (HON-1054).
          unit: 'ml',
          displayQuantity: '1l',
          category: 'dairy',
          neededBy: '2026-10-12',
          purchased: true,
          restock: false,
        },
        {
          // A staple the household marked ran out, with no amount (HON-1398).
          ingredientId: 'ing-yoghurt',
          name: 'Greek yoghurt',
          quantity: 0,
          unit: 'g',
          displayQuantity: '',
          category: 'dairy',
          neededBy: '2026-10-12',
          purchased: false,
          restock: true,
        },
      ],
      customItems: [
        { id: 'custom-1', name: 'Candles', checked: false, neededBy: null },
        { id: 'custom-2', name: 'chips', checked: false, neededBy: '2026-10-14' },
      ],
    })
    expect(getShoppingList.outputSchema.safeParse(result.structuredContent).success).toBe(true)
  })

  it('reads 14 days when asked', async () => {
    await call({ days: 14 })

    expect(loadShoppingList).toHaveBeenCalledWith(household, { days: 14 })
  })

  it('accepts only 7 or 14 days', () => {
    expect(getShoppingList.inputSchema.safeParse({ days: 30 }).success).toBe(false)
  })

  it('answers with the onboarding message without a household', async () => {
    const result = await runTool(
      getShoppingList,
      { userId: 'user-1', household: null, scopes: READ_SCOPES },
      { days: 7 },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: NO_HOUSEHOLD_MESSAGE }],
    })
    expect(loadShoppingList).not.toHaveBeenCalled()
  })
})
