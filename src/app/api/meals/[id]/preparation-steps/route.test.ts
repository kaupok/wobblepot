import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

// The lib seam, with the real error class, request builder and freshness
// check. Which meals the loader refuses, and what the write stores, is tested
// against a database in `recipe-steps.db.test.ts`.
vi.mock('@/lib/meals/recipe-steps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meals/recipe-steps')>()),
  loadRecipeForSteps: vi.fn(),
  saveRecipeSteps: vi.fn(),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => (modelName: string) => ({ modelId: modelName })),
}))

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  retryAfterSeconds: vi.fn(() => 90),
}))

vi.mock('@/lib/ai/usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/usage')>()),
  assertUnderCap: vi.fn(),
  recordAiUsage: vi.fn(),
}))

vi.mock('@/lib/feature-flags', () => ({
  getServerFlag: vi.fn(),
}))

vi.mock('@/lib/ai/sampling', () => ({
  logAiSample: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import {
  loadRecipeForSteps,
  RecipeStepsError,
  recipeStepsRequest,
  saveRecipeSteps,
} from '@/lib/meals/recipe-steps'
import { generateObject } from 'ai'
import { checkRateLimit } from '@/lib/rate-limit'
import { getServerFlag } from '@/lib/feature-flags'
import { assertUnderCap, recordAiUsage } from '@/lib/ai/usage'
import { fullStepsSchema, notesStepsSchema } from '@/lib/ai/preparation-steps'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockLoadRecipe = vi.mocked(loadRecipeForSteps)
const mockSaveRecipeSteps = vi.mocked(saveRecipeSteps)
const mockGenerateObject = vi.mocked(generateObject)
const mockCheckRateLimit = vi.mocked(checkRateLimit)

const SESSION = { user: { id: 'user-1' }, session: { id: 'session-1' } }
const FRESH = { steps: ['Boil the pasta.'], pitfalls: ['Salt the water.'] }
const STORED = { steps: ['Stored step.'], pitfalls: [] }

/** Two adults and a child: 2.5 servings (HON-1040). */
function membership(locale = 'en') {
  return {
    household: {
      id: 'household-1',
      locale,
      _count: { members: 3 },
      members: [
        { preferences: { portionMultiplier: 1 } },
        { preferences: { portionMultiplier: 1 } },
        { preferences: { portionMultiplier: 0.5 } },
      ],
    },
  }
}

type Recipe = Awaited<ReturnType<typeof loadRecipeForSteps>>

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'meal-1',
    householdId: 'household-1',
    name: 'Pasta',
    timeMinutes: 20,
    preparationNotes: null,
    components: [
      {
        quantityPerServing: 100,
        ingredient: { name: 'Pasta', defaultUnit: 'g', measuredByVolume: false },
      },
    ],
    preparationSteps: [],
    ...overrides,
  } as unknown as Recipe
}

/** A stored row written for `meal` at `servings`. */
function storedAt(meal: Recipe, servings: number) {
  const { inputHash } = recipeStepsRequest(meal, 'en', servings)
  return [{ inputHash, steps: JSON.stringify(STORED) }]
}

function callPost(body?: unknown, mealId = 'meal-1') {
  return POST(
    new Request(`http://localhost/api/meals/${mealId}/preparation-steps`, {
      method: 'POST',
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id: mealId }) },
  )
}

describe('POST /api/meals/[id]/preparation-steps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(SESSION as never)
    mockGetMembership.mockResolvedValue(membership() as never)
    mockLoadRecipe.mockResolvedValue(recipe())
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 29,
      limit: 30,
      resetAt: new Date('2026-10-26T12:00:00.000Z'),
    })
    vi.mocked(assertUnderCap).mockResolvedValue(undefined)
    vi.mocked(getServerFlag).mockResolvedValue(true)
    mockGenerateObject.mockResolvedValue({ object: FRESH } as never)
  })

  it('returns 401 with no session', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await callPost({ servings: 2 })

    expect(response.status).toBe(401)
    expect((await response.json()).code).toBe('unauthorized')
    expect(mockLoadRecipe).not.toHaveBeenCalled()
  })

  it('returns 404 with no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await callPost({ servings: 2 })

    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('no_household')
  })

  it("returns 404 for a meal the loader refuses, as another household's recipe", async () => {
    mockLoadRecipe.mockRejectedValue(new RecipeStepsError('not_found'))

    const response = await callPost({ servings: 2 }, 'meal-other')

    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('meal_not_found')
    expect(mockLoadRecipe).toHaveBeenCalledWith('household-1', 'meal-other', 'en')
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it.each([0, 21, 2.3, '4'])('returns 400 for servings %j', async (servings) => {
    const response = await callPost({ servings })

    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('invalid_servings')
    expect(mockLoadRecipe).not.toHaveBeenCalled()
  })

  it("accepts a large household's own count above the serving control's range", async () => {
    mockGetMembership.mockResolvedValue({
      household: {
        ...membership().household,
        members: Array.from({ length: 24 }, () => ({ preferences: { portionMultiplier: 1 } })),
      },
    } as never)

    const response = await callPost({ servings: 24 })

    expect(response.status).toBe(200)
    expect(mockSaveRecipeSteps).toHaveBeenCalledWith(
      expect.objectContaining({ servings: 24 }),
      FRESH,
    )
  })

  it("generates at the household's servings when the body names none, and stores them", async () => {
    const response = await callPost()

    expect(response.status).toBe(200)
    expect((await response.json()).tips).toEqual(FRESH)
    expect(mockSaveRecipeSteps).toHaveBeenCalledWith(
      {
        mealId: 'meal-1',
        locale: 'en',
        servings: 2.5,
        inputHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      FRESH,
    )
    // 100 g a serving × 2.5
    const { prompt } = mockGenerateObject.mock.calls[0]![0] as { prompt: string }
    expect(prompt).toContain('Servings: 2.5')
    expect(prompt).toContain('- Pasta: 250g')
  })

  it('generates at the servings the view shows, with the full prompt', async () => {
    await callPost({ servings: 6 })

    const request = mockGenerateObject.mock.calls[0]![0] as { prompt: string; schema: unknown }
    expect(request.schema).toBe(fullStepsSchema)
    expect(request.prompt).toContain('Meal: Pasta')
    expect(request.prompt).toContain('Servings: 6')
    expect(request.prompt).toContain('- Pasta: 600g')
    // The household's own list is the whole meal (HON-1245).
    expect(request.prompt).toContain("The household changed this meal's ingredients")
    expect(mockSaveRecipeSteps).toHaveBeenCalledWith(
      expect.objectContaining({ servings: 6 }),
      FRESH,
    )
  })

  it('serves stored steps at the same servings with no AI call', async () => {
    const meal = recipe()
    mockLoadRecipe.mockResolvedValue(recipe({ preparationSteps: storedAt(meal, 4) }))

    const response = await callPost({ servings: 4 })

    expect((await response.json()).tips).toEqual(STORED)
    expect(mockGenerateObject).not.toHaveBeenCalled()
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
    expect(mockSaveRecipeSteps).not.toHaveBeenCalled()
  })

  it('generates new steps when the stored ones are for other servings', async () => {
    const meal = recipe()
    mockLoadRecipe.mockResolvedValue(recipe({ preparationSteps: storedAt(meal, 2) }))

    const response = await callPost({ servings: 4 })

    expect((await response.json()).tips).toEqual(FRESH)
    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
  })

  it('generates new steps after the recipe was edited', async () => {
    const before = recipe()
    mockLoadRecipe.mockResolvedValue(
      recipe({ name: 'Pasta bake', preparationSteps: storedAt(before, 4) }),
    )

    const response = await callPost({ servings: 4 })

    expect((await response.json()).tips).toEqual(FRESH)
    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
  })

  it('builds the steps from the notes for a recipe with notes', async () => {
    mockLoadRecipe.mockResolvedValue(recipe({ preparationNotes: 'Bake for 20 minutes.' }))

    await callPost({ servings: 2 })

    const request = mockGenerateObject.mock.calls[0]![0] as { prompt: string; schema: unknown }
    expect(request.schema).toBe(notesStepsSchema)
    expect(request.prompt).toContain('Bake for 20 minutes.')
    expect(request.prompt).toContain('- Pasta: 200g')
  })

  describe('a library meal (HON-1351)', () => {
    const library = (overrides: Partial<Recipe> = {}) =>
      recipe({
        id: 'meal-porridge',
        householdId: null,
        name: 'Porridge',
        servings: 4,
        ...overrides,
      })

    it('writes its steps from the full prompt, unchanged and without notes, and stores them', async () => {
      mockLoadRecipe.mockResolvedValue(library({ preparationNotes: 'Stir often.' }))

      const response = await callPost({ servings: 4 }, 'meal-porridge')

      expect(response.status).toBe(200)
      expect((await response.json()).tips).toEqual(FRESH)
      expect(mockLoadRecipe).toHaveBeenCalledWith('household-1', 'meal-porridge', 'en')
      const request = mockGenerateObject.mock.calls[0]![0] as { prompt: string; schema: unknown }
      expect(request.schema).toBe(fullStepsSchema)
      expect(request.prompt).toContain('Meal: Porridge')
      expect(request.prompt).not.toContain("The household changed this meal's ingredients")
      expect(request.prompt).not.toContain('Stir often.')
      expect(vi.mocked(recordAiUsage)).toHaveBeenCalledWith(
        expect.objectContaining({ householdId: 'household-1' }),
      )
      expect(mockSaveRecipeSteps).toHaveBeenCalledWith(
        expect.objectContaining({ mealId: 'meal-porridge', locale: 'en', servings: 4 }),
        FRESH,
      )
    })

    it('serves a second call at the same locale and servings from the stored row', async () => {
      mockLoadRecipe.mockResolvedValue(library())
      await callPost({ servings: 4 }, 'meal-porridge')
      const [row, steps] = mockSaveRecipeSteps.mock.calls[0]!
      mockLoadRecipe.mockResolvedValue(
        library({ preparationSteps: [{ inputHash: row.inputHash, steps: JSON.stringify(steps) }] }),
      )
      vi.clearAllMocks()

      const response = await callPost({ servings: 4 }, 'meal-porridge')

      expect((await response.json()).tips).toEqual(FRESH)
      expect(mockGenerateObject).not.toHaveBeenCalled()
      expect(mockCheckRateLimit).not.toHaveBeenCalled()
      expect(mockSaveRecipeSteps).not.toHaveBeenCalled()
    })

    it("serves but does not store steps at a count other than the meal's own", async () => {
      mockLoadRecipe.mockResolvedValue(library({ preparationSteps: storedAt(library(), 4) }))

      const response = await callPost({ servings: 2.5 }, 'meal-porridge')

      expect((await response.json()).tips).toEqual(FRESH)
      expect(mockGenerateObject).toHaveBeenCalledTimes(1)
      expect(mockSaveRecipeSteps).not.toHaveBeenCalled()
    })
  })

  it('serves but does not store steps when the stored locale fell back to English', async () => {
    mockGetMembership.mockResolvedValue(membership('xx') as never)

    const response = await callPost({ servings: 2 })

    expect((await response.json()).tips).toEqual(FRESH)
    expect(mockLoadRecipe).toHaveBeenCalledWith('household-1', 'meal-1', 'en')
    expect(mockSaveRecipeSteps).not.toHaveBeenCalled()
  })

  it('returns 429 over the hourly limit, without an AI call', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      limit: 30,
      resetAt: new Date('2026-10-26T12:00:00.000Z'),
    })

    const response = await callPost({ servings: 2 })

    expect(response.status).toBe(429)
    expect((await response.json()).code).toBe('rate_limited')
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it('returns 503 while AI generation is switched off', async () => {
    vi.mocked(getServerFlag).mockResolvedValue(false)

    const response = await callPost({ servings: 2 })

    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe('generation_disabled')
  })

  it('returns 500 when the generation fails, and stores nothing', async () => {
    mockGenerateObject.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await callPost({ servings: 2 })

    expect(response.status).toBe(500)
    expect((await response.json()).code).toBe('tips_failed')
    expect(mockSaveRecipeSteps).not.toHaveBeenCalled()
  })
})
