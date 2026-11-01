import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-keys', () => ({
  API_KEY_PATTERN: /^wp_[A-Za-z0-9]{32}$/,
  verifyApiKey: vi.fn().mockResolvedValue({ userId: 'user-1' }),
  isActiveApiKeyUser: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/household', () => ({ getHouseholdMembership: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
  retryAfterSeconds: vi.fn(),
}))
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))
vi.mock('@/lib/shopping/load-shopping-list', () => ({ loadShoppingList: vi.fn() }))

import { getHouseholdMembership } from '@/lib/household'
import { runTool } from '@/lib/mcp/context'
import { getShoppingList } from '@/lib/mcp/tools/get-shopping-list'
import { loadShoppingList, type ShoppingListResult } from '@/lib/shopping/load-shopping-list'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'

import { GET } from './route'

const KEY = 'wp_abcdefghijklmnopqrstuvwxyz012345'
const household = mcpHousehold({ id: 'household-1' })

const LIST = {
  windowDays: 14,
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
        },
      ],
    },
  ],
  customItems: [
    { id: 'custom-1', name: 'Candles', checked: true, ingredientId: null, neededBy: null },
    { id: 'custom-2', name: 'chips', checked: false, ingredientId: null, neededBy: '2026-10-14' },
  ],
  check: [],
} as unknown as ShoppingListResult

function get(query = '') {
  return GET(
    new Request(`http://localhost:3000/api/v1/shopping-list${query}`, {
      headers: { authorization: `Bearer ${KEY}` },
    }),
  )
}

describe('GET /api/v1/shopping-list (HON-1220)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getHouseholdMembership).mockResolvedValue({ household } as never)
    vi.mocked(loadShoppingList).mockResolvedValue(LIST)
  })

  it('answers the same JSON as get_shopping_list with days: 14', async () => {
    const response = await get('?days=14')
    const tool = await runTool(
      getShoppingList,
      { userId: 'user-1', household, scopes: READ_SCOPES },
      { days: 14 },
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual(tool.structuredContent)
    expect(body).toEqual({
      days: 14,
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
        },
      ],
      customItems: [
        { id: 'custom-1', name: 'Candles', checked: true, neededBy: null },
        { id: 'custom-2', name: 'chips', checked: false, neededBy: '2026-10-14' },
      ],
      check: [],
    })
    expect(loadShoppingList).toHaveBeenCalledWith(household, { days: 14 })
  })

  it('defaults to 7 days', async () => {
    const body = await (await get()).json()

    expect(body.days).toBe(7)
    expect(loadShoppingList).toHaveBeenLastCalledWith(household, { days: 7 })
  })

  it.each(['?days=10', '?days=', '?days=seven'])(
    'answers 400 bad_request for %s',
    async (query) => {
      const response = await get(query)

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        code: 'bad_request',
        error: 'Ask for days=7 or days=14.',
      })
      expect(loadShoppingList).not.toHaveBeenCalled()
    },
  )
})
