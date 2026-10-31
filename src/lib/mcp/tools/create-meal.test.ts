import { beforeEach, describe, expect, it, vi } from 'vitest'

// The save, the refusals and the matching are tested against a database in
// `create-meal.db.test.ts`. This file mocks them at the seam and asserts what
// the tool owns on top: when it starts the recipe's image (HON-1503).

// `after()` callbacks are collected and run by the test, so a case can assert
// on the tool's answer before the draw has started, as in production.
const afterCallbacks: Array<() => unknown> = []
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn((callback: () => unknown) => {
    afterCallbacks.push(callback)
  }),
}))
vi.mock('@/lib/meal-images/start', () => ({
  claimSavedMealImage: vi.fn(),
  drawSavedMealImage: vi.fn(),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
}))
vi.mock('@/lib/household-meals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/household-meals')>()),
  findOwnMealByName: vi.fn(),
  createHouseholdMeal: vi.fn(),
}))
vi.mock('./recipe-input', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recipe-input')>()),
  matchRecipeIngredients: vi.fn(),
}))

import type { MatchedIngredient } from '@/lib/ai/match-ingredients'
import { createHouseholdMeal, findOwnMealByName, HouseholdMealError } from '@/lib/household-meals'
import { runTool } from '@/lib/mcp/context'
import { claimSavedMealImage, drawSavedMealImage } from '@/lib/meal-images/start'
import { mcpHousehold, WRITE_SCOPES } from '@/test/mcp'

import { createMeal } from './create-meal'
import { matchRecipeIngredients } from './recipe-input'

const household = mcpHousehold({ id: 'household-a' })
const ctx = { userId: 'user-a', household, scopes: WRITE_SCOPES }

function call(input: Record<string, unknown> = {}) {
  return runTool(
    createMeal,
    ctx,
    createMeal.inputSchema.parse({
      name: 'Fish tacos',
      servings: 4,
      suitableFor: ['dinner'],
      ingredients: [{ name: 'cod', quantity: 500, unit: 'g' }],
      ...input,
    }),
  )
}

const cod = {
  type: 'matched',
  extractedName: 'cod',
  extractedQuantity: 500,
  extractedUnit: 'g',
  originalText: '500 g cod',
  ingredient: { id: 'ing-cod', name: 'Cod', defaultUnit: 'g', proteinType: 'fish' },
  convertedQuantity: 500,
  isVague: false,
} as unknown as MatchedIngredient

const claim = { meal: { id: 'meal-new' }, claim: 'claim-token' }

describe('create_meal image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    afterCallbacks.length = 0
    vi.mocked(findOwnMealByName).mockResolvedValue(null)
    vi.mocked(matchRecipeIngredients).mockResolvedValue({ outcome: 'matched', matched: [cod] })
    vi.mocked(createHouseholdMeal).mockResolvedValue({
      id: 'meal-new',
      name: 'Fish tacos',
      primaryProteinType: 'fish',
      proteinTypeOverride: null,
    } as never)
    vi.mocked(claimSavedMealImage).mockResolvedValue(claim as never)
  })

  it('claims the saved recipe’s image and draws it after answering', async () => {
    const result = await call()

    expect(result.structuredContent).toMatchObject({ outcome: 'created' })
    expect(claimSavedMealImage).toHaveBeenCalledWith('household-a', 'meal-new', '/api/mcp')
    // The tool has answered and the draw has not started.
    expect(drawSavedMealImage).not.toHaveBeenCalled()
    expect(afterCallbacks).toHaveLength(1)

    await afterCallbacks[0]!()

    expect(drawSavedMealImage).toHaveBeenCalledWith(claim, {
      householdId: 'household-a',
      userId: 'user-a',
      route: '/api/mcp',
    })
  })

  it('schedules no draw when the claim is not won', async () => {
    vi.mocked(claimSavedMealImage).mockResolvedValue(null)

    const result = await call()

    expect(result.structuredContent).toMatchObject({ outcome: 'created' })
    expect(afterCallbacks).toHaveLength(0)
  })

  it.each([
    [
      'exists',
      () => vi.mocked(findOwnMealByName).mockResolvedValue({ id: 'meal-1', name: 'Fish tacos' }),
    ],
    [
      'unmatched',
      () =>
        vi
          .mocked(matchRecipeIngredients)
          .mockResolvedValue({ outcome: 'unmatched', unmatched: [] }),
    ],
    [
      'check_quantity',
      () =>
        vi
          .mocked(matchRecipeIngredients)
          .mockResolvedValue({ outcome: 'check_quantity', check: [] }),
    ],
    [
      'check_protein',
      () =>
        vi
          .mocked(createHouseholdMeal)
          .mockRejectedValue(new HouseholdMealError('proteinTypeNotInRecipe')),
    ],
  ])('starts no image for %s', async (outcome, arrange) => {
    arrange()

    const result = await call()

    expect(result.structuredContent).toMatchObject({ outcome })
    expect(claimSavedMealImage).not.toHaveBeenCalled()
    expect(afterCallbacks).toHaveLength(0)
  })
})
