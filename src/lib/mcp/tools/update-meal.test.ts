import { beforeEach, describe, expect, it, vi } from 'vitest'

// The update and what it clears are tested against a database in
// `update-meal.db.test.ts`. This file mocks them at the seam and asserts what
// the tool owns on top: when it starts a new image (HON-1503).

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
vi.mock('@/lib/meal-images/storage', () => ({
  discardMealImage: vi.fn(),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
}))
vi.mock('@/lib/household-meals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/household-meals')>()),
  updateHouseholdMeal: vi.fn(),
}))
vi.mock('@/lib/household-meals-read', () => ({
  getHouseholdMeal: vi.fn(),
}))

import { updateHouseholdMeal } from '@/lib/household-meals'
import { getHouseholdMeal } from '@/lib/household-meals-read'
import { runTool } from '@/lib/mcp/context'
import { claimSavedMealImage, drawSavedMealImage } from '@/lib/meal-images/start'
import { mcpHousehold, WRITE_SCOPES } from '@/test/mcp'

import { updateMeal } from './update-meal'

const household = mcpHousehold({ id: 'household-a' })
const ctx = { userId: 'user-a', household, scopes: WRITE_SCOPES }

function call(input: Record<string, unknown>) {
  return runTool(updateMeal, ctx, updateMeal.inputSchema.parse({ mealId: 'meal-1', ...input }))
}

const claim = { meal: { id: 'meal-1' }, claim: 'claim-token' }

function update(imageInvalidated: boolean) {
  return {
    meal: { id: 'meal-1' },
    discardedImageUrl: imageInvalidated ? 'https://blob.example/old.png' : null,
    imageInvalidated,
  } as never
}

describe('update_meal image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    afterCallbacks.length = 0
    vi.mocked(getHouseholdMeal).mockResolvedValue({
      id: 'meal-1',
      name: 'Fish tacos',
      servings: 4,
      deletedAt: null,
      components: [],
      primaryProteinType: 'fish',
      proteinTypeOverride: null,
    } as never)
    vi.mocked(claimSavedMealImage).mockResolvedValue(claim as never)
  })

  it('starts a new image when the update cleared it, after answering', async () => {
    vi.mocked(updateHouseholdMeal).mockResolvedValue(update(true))

    const result = await call({ description: 'Crisp cod in warm tortillas.' })

    expect(result.structuredContent).toMatchObject({ outcome: 'updated' })
    expect(claimSavedMealImage).toHaveBeenCalledWith('household-a', 'meal-1', '/api/mcp')
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
    vi.mocked(updateHouseholdMeal).mockResolvedValue(update(true))
    vi.mocked(claimSavedMealImage).mockResolvedValue(null)

    const result = await call({ description: 'Crisp cod in warm tortillas.' })

    expect(result.structuredContent).toMatchObject({ outcome: 'updated' })
    expect(afterCallbacks).toHaveLength(0)
  })

  it('starts no image when the update kept it (servings only)', async () => {
    vi.mocked(updateHouseholdMeal).mockResolvedValue(update(false))

    const result = await call({ servings: 6 })

    expect(result.structuredContent).toMatchObject({ outcome: 'updated' })
    expect(claimSavedMealImage).not.toHaveBeenCalled()
    expect(afterCallbacks).toHaveLength(0)
  })
})
