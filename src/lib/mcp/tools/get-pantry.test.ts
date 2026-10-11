import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
}))
vi.mock('@/lib/meal-planning/load-pantry', () => ({ loadPantry: vi.fn() }))

import { loadPantry, type PantryResult } from '@/lib/meal-planning/load-pantry'
import { mcpHousehold } from '@/test/mcp'
import { NO_HOUSEHOLD_MESSAGE, runTool } from '@/lib/mcp/context'
import { getPantry } from './get-pantry'

const household = mcpHousehold({ id: 'household-1' })
const ctx = { userId: 'user-1', household }

const PANTRY = {
  windowDays: 7,
  items: [
    {
      id: 'pantry-1',
      ingredientId: 'ing-rice',
      ingredient: { id: 'ing-rice', name: 'Rice', category: 'carb', defaultUnit: 'g' },
      quantity: 500,
      isStaple: true,
      updatedAt: new Date(),
      neededQuantity: 200,
      neededDisplayQuantity: '200g',
      windowDays: 7,
      isVague: false,
    },
    {
      id: 'pantry-2',
      ingredientId: 'ing-salt',
      ingredient: { id: 'ing-salt', name: 'Salt', category: 'spice', defaultUnit: 'g' },
      quantity: null,
      isStaple: false,
      updatedAt: new Date(),
    },
  ],
} as unknown as PantryResult

describe('get_pantry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadPantry).mockResolvedValue(PANTRY)
  })

  it('lists the pantry, marking what the next 7 days of meals need', async () => {
    const result = await runTool(getPantry, ctx, {})

    expect(loadPantry).toHaveBeenCalledWith(household, { days: 7 })
    expect(result.structuredContent).toEqual({
      items: [
        {
          ingredientId: 'ing-rice',
          name: 'Rice',
          quantity: 500,
          unit: 'g',
          isStaple: true,
          neededSoon: true,
        },
        {
          ingredientId: 'ing-salt',
          name: 'Salt',
          quantity: null,
          unit: 'g',
          isStaple: false,
          neededSoon: false,
        },
      ],
    })
    expect(getPantry.outputSchema.safeParse(result.structuredContent).success).toBe(true)
  })

  it('answers with the onboarding message without a household', async () => {
    const result = await runTool(getPantry, { userId: 'user-1', household: null }, {})

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: NO_HOUSEHOLD_MESSAGE }],
    })
    expect(loadPantry).not.toHaveBeenCalled()
  })
})
