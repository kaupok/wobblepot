import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH, DELETE } from './route'

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    meal: {
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    ingredient: {
      findMany: vi.fn(),
    },
    mealComponent: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/meal-planning/protein', () => ({
  deriveProteinType: vi.fn(() => 'poultry'),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { deriveProteinType } from '@/lib/meal-planning/protein'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockMealFindFirst = vi.mocked(prisma.meal.findFirst)
const mockTransaction = vi.mocked(prisma.$transaction)
const mockIngredientFindMany = vi.mocked(prisma.ingredient.findMany)

const mockHousehold = {
  id: 'household-123',
  name: 'Test Household',
  timezone: 'Europe/Tallinn',
  preferences: null,
}

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: mockHousehold,
}

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
}

const mockMealResult = {
  id: 'meal-1',
  name: 'Chicken Rice Bowl',
  description: 'Simple chicken rice',
  timeMinutes: 30,
  kidFriendly: true,
  primaryProteinType: 'poultry',
  suitableFor: ['dinner'],
  deletedAt: null,
  createdAt: new Date('2026-01-15'),
  updatedAt: new Date('2026-01-15'),
  components: [
    {
      ingredientId: 'ing-1',
      quantityPerServing: 150,
      ingredient: {
        id: 'ing-1',
        name: 'Chicken breast',
        category: 'protein',
        defaultUnit: 'g',
        gramsPerPiece: null,
        calories: 165,
        protein: 31,
        carbs: 0,
        fat: 3.6,
        allergens: [],
      },
    },
  ],
  favoritedBy: [],
}

const paramsPromise = (id: string) => Promise.resolve({ id })

/**
 * Mocks `prisma.$transaction` for the PATCH route and hands back the spies the
 * PATCH tests assert on: `mealPlanEntry.updateMany` for the prep-tips
 * invalidation (HON-683), and `meal.update` plus the two `mealComponent`
 * writers for the component rewrite (HON-701).
 *
 * `tx.meal.findUniqueOrThrow` serves two reads: the divisor read the component
 * path makes inside the transaction (selects `servings`), and the final fetch
 * of the updated row. They are told apart by their `select`, not by call order,
 * so a test that adds a read cannot silently get the wrong fixture. Pass
 * `currentMeal` whenever the payload carries `components`.
 */
const setupTransaction = (updatedMeal: unknown, currentMeal?: unknown) => {
  const mealPlanEntryUpdateMany = vi.fn()
  const mealUpdate = vi.fn()
  const mealComponentDeleteMany = vi.fn()
  const mealComponentCreateMany = vi.fn()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockTransaction.mockImplementation(async (fn: any) => {
    const tx = {
      meal: {
        update: mealUpdate,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findUniqueOrThrow: vi.fn(async (args: any) =>
          args?.select?.servings ? (currentMeal ?? updatedMeal) : updatedMeal,
        ),
      },
      mealComponent: {
        deleteMany: mealComponentDeleteMany,
        createMany: mealComponentCreateMany,
      },
      mealPlanEntry: {
        updateMany: mealPlanEntryUpdateMany,
      },
    }
    return fn(tx)
  })

  return { mealPlanEntryUpdateMany, mealUpdate, mealComponentDeleteMany, mealComponentCreateMany }
}

const patchMeal = (body: Record<string, unknown>) =>
  PATCH(
    new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: paramsPromise('meal-1') },
  )

describe('GET /api/households/me/meals/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const request = new NextRequest('http://localhost/api/households/me/meals/meal-1')
    const response = await GET(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const request = new NextRequest('http://localhost/api/households/me/meals/meal-1')
    const response = await GET(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 404 when meal not found', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealFindFirst.mockResolvedValue(null)

    const request = new NextRequest('http://localhost/api/households/me/meals/nonexistent')
    const response = await GET(request, { params: paramsPromise('nonexistent') })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Meal not found')
  })

  it('returns meal with nutrition and allergens', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealFindFirst.mockResolvedValue(mockMealResult as never)

    const request = new NextRequest('http://localhost/api/households/me/meals/meal-1')
    const response = await GET(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.id).toBe('meal-1')
    expect(data.name).toBe('Chicken Rice Bowl')
    expect(data.isCustom).toBe(true)
    expect(data.isFavorite).toBe(false)
    expect(data.nutrition).toBeDefined()
    expect(data.nutrition.calories).toBeGreaterThan(0)
    expect(data.allergens).toEqual([])
    expect(data.components).toHaveLength(1)
  })
})

describe('PATCH /api/households/me/meals/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
    })
    const response = await PATCH(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 400 for invalid JSON', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'PATCH',
      body: 'not valid json',
    })
    const response = await PATCH(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 for validation errors', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: '' }), // min length 1
    })
    const response = await PATCH(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
  })

  it('rejects javascript: protocol URLs in sourceUrl', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'PATCH',
      body: JSON.stringify({ sourceUrl: 'javascript:alert(document.cookie)' }),
    })
    const response = await PATCH(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
    })
    const response = await PATCH(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 404 when meal not found', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealFindFirst.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/meals/nonexistent', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
    })
    const response = await PATCH(request, { params: paramsPromise('nonexistent') })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Meal not found')
  })

  it('updates meal name successfully', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealFindFirst.mockResolvedValue({ ...mockMealResult, deletedAt: null } as never)

    setupTransaction({
      ...mockMealResult,
      name: 'Updated Chicken Bowl',
      updatedAt: new Date(),
    })

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated Chicken Bowl' }),
    })
    const response = await PATCH(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.name).toBe('Updated Chicken Bowl')
    expect(data.nutrition).toBeDefined()
  })

  // HON-683: `preparationTips` is cached per entry from a prompt built out of
  // the meal's name, time budget, notes and components scaled by servings, so
  // an edit to any of those has to drop the cache — and an edit to a field the
  // prompt never sees must not. The meal form resends its whole payload on
  // every save, so these assert on values changing, not on fields being sent.
  describe('cached preparation tips', () => {
    const expectedInvalidation = {
      where: { mealId: 'meal-1', preparationTips: { not: null } },
      data: { preparationTips: null },
    }

    // What is already in the database. 600g of chicken over 4 servings is the
    // 150 per-serving the stored component holds, so a payload resending
    // `totalQuantity: 600` describes no change at all.
    const storedMeal = {
      ...mockMealResult,
      deletedAt: null,
      name: 'Chicken Rice Bowl',
      preparationNotes: 'Sear the chicken first',
      sourceUrl: null,
      timeMinutes: 30,
      servings: 4,
      components: [{ ingredientId: 'ing-1', quantityPerServing: 150 }],
    }

    const unchangedPayload = {
      name: 'Chicken Rice Bowl',
      preparationNotes: 'Sear the chicken first',
      timeMinutes: 30,
      servings: 4,
      components: [{ ingredientId: 'ing-1', totalQuantity: 600 }],
    }

    beforeEach(() => {
      mockGetSession.mockResolvedValue(mockSession as never)
      mockGetMembership.mockResolvedValue(mockMembership as never)
      mockMealFindFirst.mockResolvedValue(storedMeal as never)
      mockIngredientFindMany.mockResolvedValue([
        { id: 'ing-1', proteinType: 'poultry', protein: 31 },
      ] as never)
    })

    it('clears tips when a component quantity changes', async () => {
      const { mealPlanEntryUpdateMany } = setupTransaction(mockMealResult, storedMeal)

      const response = await patchMeal({
        ...unchangedPayload,
        components: [{ ingredientId: 'ing-1', totalQuantity: 800 }],
      })

      expect(response.status).toBe(200)
      expect(mealPlanEntryUpdateMany).toHaveBeenCalledTimes(1)
      expect(mealPlanEntryUpdateMany).toHaveBeenCalledWith(expectedInvalidation)
    })

    it('clears tips when a component is swapped for another ingredient', async () => {
      mockIngredientFindMany.mockResolvedValue([
        { id: 'ing-2', proteinType: 'plant', protein: 8 },
      ] as never)
      const { mealPlanEntryUpdateMany } = setupTransaction(mockMealResult, storedMeal)

      const response = await patchMeal({
        ...unchangedPayload,
        components: [{ ingredientId: 'ing-2', totalQuantity: 600 }],
      })

      expect(response.status).toBe(200)
      expect(mealPlanEntryUpdateMany).toHaveBeenCalledWith(expectedInvalidation)
    })

    // A servings edit from the form restates the same totals over a new
    // divisor, so every `quantityPerServing` moves and the prompt's ingredient
    // lines move with it — 600g over 6 is 100 per serving, not the stored 150.
    it('clears tips when servings change, via the component quantities', async () => {
      const { mealPlanEntryUpdateMany } = setupTransaction(mockMealResult, storedMeal)

      const response = await patchMeal({ ...unchangedPayload, servings: 6 })

      expect(response.status).toBe(200)
      expect(mealPlanEntryUpdateMany).toHaveBeenCalledWith(expectedInvalidation)
    })

    // The converse, and the reason `servings` has no clause of its own: the
    // prompt scales by the entry's effective servings, so a bare `servings`
    // PATCH that leaves every `quantityPerServing` where it was produces a
    // byte-identical prompt and must not regenerate the household's plan.
    it('leaves tips alone for a servings change that moves no component quantity', async () => {
      const { mealPlanEntryUpdateMany } = setupTransaction(mockMealResult, storedMeal)

      const response = await patchMeal({ servings: 8 })

      expect(response.status).toBe(200)
      expect(mealPlanEntryUpdateMany).not.toHaveBeenCalled()
    })

    it('clears tips when timeMinutes changes', async () => {
      const { mealPlanEntryUpdateMany } = setupTransaction(mockMealResult, storedMeal)

      const response = await patchMeal({ ...unchangedPayload, timeMinutes: 45 })

      expect(response.status).toBe(200)
      expect(mealPlanEntryUpdateMany).toHaveBeenCalledWith(expectedInvalidation)
    })

    it('clears tips when the name changes', async () => {
      const { mealPlanEntryUpdateMany } = setupTransaction(mockMealResult, storedMeal)

      const response = await patchMeal({ ...unchangedPayload, name: 'Tofu Rice Bowl' })

      expect(response.status).toBe(200)
      expect(mealPlanEntryUpdateMany).toHaveBeenCalledWith(expectedInvalidation)
    })

    it('clears tips when preparationNotes change', async () => {
      const { mealPlanEntryUpdateMany } = setupTransaction(mockMealResult, storedMeal)

      const response = await patchMeal({
        ...unchangedPayload,
        preparationNotes: 'Marinate overnight',
      })

      expect(response.status).toBe(200)
      expect(mealPlanEntryUpdateMany).toHaveBeenCalledWith(expectedInvalidation)
    })

    // The half that pays for the per-field condition: the form sends every
    // field on every save, so these full payloads differ only in something the
    // prompt never reads. Firing here would regenerate the household's whole
    // plan over a pasted link.
    it('leaves tips alone when only sourceUrl changes', async () => {
      const { mealPlanEntryUpdateMany } = setupTransaction(mockMealResult, storedMeal)

      const response = await patchMeal({
        ...unchangedPayload,
        sourceUrl: 'https://example.com/recipe',
      })

      expect(response.status).toBe(200)
      expect(mealPlanEntryUpdateMany).not.toHaveBeenCalled()
    })

    it('leaves tips alone when only description and kidFriendly change', async () => {
      const { mealPlanEntryUpdateMany } = setupTransaction(mockMealResult, storedMeal)

      const response = await patchMeal({
        ...unchangedPayload,
        description: 'Weeknight staple',
        kidFriendly: false,
      })

      expect(response.status).toBe(200)
      expect(mealPlanEntryUpdateMany).not.toHaveBeenCalled()
    })

    it('leaves tips alone when the payload resends every stored value unchanged', async () => {
      const { mealPlanEntryUpdateMany } = setupTransaction(mockMealResult, storedMeal)

      const response = await patchMeal(unchangedPayload)

      expect(response.status).toBe(200)
      expect(mealPlanEntryUpdateMany).not.toHaveBeenCalled()
    })
  })

  // HON-701: `components` and `servings` are independently optional, but the
  // component path used to be gated on both, so a components-only PATCH wrote
  // nothing and still answered 200 with the unchanged list. The divisor for
  // `quantityPerServing` is now the meal's stored `servings`.
  describe('components sent without servings', () => {
    // 750g of chicken over the stored 5 servings is the 150 per-serving on
    // disk, so a payload of 800 scaled by the same 5 lands on 160. The 5 is
    // deliberately not `Meal.servings`'s `@default(4)` — with 4 here, a
    // hardcoded `servings ?? 4` that never reads the stored meal would pass
    // every assertion below, including the one this describe exists for.
    const storedMeal = {
      ...mockMealResult,
      deletedAt: null,
      servings: 5,
      preparationNotes: 'Sear the chicken first',
      sourceUrl: null,
      components: [{ ingredientId: 'ing-1', quantityPerServing: 150 }],
    }

    beforeEach(() => {
      mockGetSession.mockResolvedValue(mockSession as never)
      mockGetMembership.mockResolvedValue(mockMembership as never)
      mockMealFindFirst.mockResolvedValue(storedMeal as never)
      mockIngredientFindMany.mockResolvedValue([
        { id: 'ing-1', proteinType: 'poultry', protein: 31 },
      ] as never)
    })

    it('rewrites the component rows against the stored servings', async () => {
      const { mealComponentDeleteMany, mealComponentCreateMany } = setupTransaction(
        mockMealResult,
        storedMeal,
      )

      const response = await patchMeal({
        components: [{ ingredientId: 'ing-1', totalQuantity: 800 }],
      })

      expect(response.status).toBe(200)
      expect(mealComponentDeleteMany).toHaveBeenCalledWith({ where: { mealId: 'meal-1' } })
      expect(mealComponentCreateMany).toHaveBeenCalledWith({
        data: [
          {
            mealId: 'meal-1',
            ingredientId: 'ing-1',
            quantityPerServing: 160,
            isVague: false,
            originalPhrase: null,
          },
        ],
      })
    })

    it('clears cached preparation tips for that same request', async () => {
      mockIngredientFindMany.mockResolvedValue([
        { id: 'ing-2', proteinType: 'plant', protein: 8 },
      ] as never)
      const { mealPlanEntryUpdateMany } = setupTransaction(mockMealResult, storedMeal)

      const response = await patchMeal({
        components: [{ ingredientId: 'ing-2', totalQuantity: 800 }],
      })

      expect(response.status).toBe(200)
      expect(mealPlanEntryUpdateMany).toHaveBeenCalledWith({
        where: { mealId: 'meal-1', preparationTips: { not: null } },
        data: { preparationTips: null },
      })
    })

    it('recomputes primaryProteinType on that path', async () => {
      mockIngredientFindMany.mockResolvedValue([
        { id: 'ing-2', proteinType: 'plant', protein: 8 },
      ] as never)
      vi.mocked(deriveProteinType).mockReturnValueOnce('plant' as never)
      const { mealUpdate } = setupTransaction(mockMealResult, storedMeal)

      const response = await patchMeal({
        components: [{ ingredientId: 'ing-2', totalQuantity: 800 }],
      })

      expect(response.status).toBe(200)
      expect(deriveProteinType).toHaveBeenCalledWith([
        { quantityPerServing: 160, ingredient: { id: 'ing-2', proteinType: 'plant', protein: 8 } },
      ])
      expect(mealUpdate).toHaveBeenCalledWith({
        where: { id: 'meal-1' },
        data: expect.objectContaining({ primaryProteinType: 'plant' }),
      })
    })

    it('still returns 400 when a component names an unknown ingredient', async () => {
      mockIngredientFindMany.mockResolvedValue([] as never)
      const { mealComponentCreateMany } = setupTransaction(mockMealResult, storedMeal)

      const response = await patchMeal({
        components: [{ ingredientId: 'ing-missing', totalQuantity: 800 }],
      })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.missingIds).toEqual(['ing-missing'])
      expect(mealComponentCreateMany).not.toHaveBeenCalled()
    })

    // The divisor decides what gets written, so it is read inside the write
    // transaction rather than from the pre-transaction lookup at the top of the
    // handler. A concurrent servings edit landing between the two would
    // otherwise store the rows under a divisor the meal no longer uses. Here
    // the meal is read as 5 servings before the transaction and 8 inside it:
    // 800 must be scaled by the 8 that is actually current.
    it('scales against the servings read inside the transaction', async () => {
      const { mealComponentCreateMany } = setupTransaction(mockMealResult, {
        ...storedMeal,
        servings: 8,
      })

      const response = await patchMeal({
        components: [{ ingredientId: 'ing-1', totalQuantity: 800 }],
      })

      expect(response.status).toBe(200)
      expect(mealComponentCreateMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ quantityPerServing: 100 })],
      })
    })

    // The existence check below it cannot tell a repeated id from a missing
    // one — `findMany` returns one row for two components — so it used to
    // answer `400 { missingIds: [] }`, naming nothing. Newly reachable on this
    // path, hence pinned here.
    it('names the repeated ingredient when a component id appears twice', async () => {
      const { mealComponentCreateMany } = setupTransaction(mockMealResult, storedMeal)

      const response = await patchMeal({
        components: [
          { ingredientId: 'ing-1', totalQuantity: 400 },
          { ingredientId: 'ing-1', totalQuantity: 350 },
        ],
      })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.duplicateIds).toEqual(['ing-1'])
      expect(mealComponentCreateMany).not.toHaveBeenCalled()
    })

    // The other direction, unchanged by HON-701: a bare `servings` edit leaves
    // the stored per-serving quantities exactly where they are.
    it('leaves the component rows alone for a servings-only PATCH', async () => {
      const { mealComponentDeleteMany, mealComponentCreateMany, mealUpdate } = setupTransaction(
        mockMealResult,
        storedMeal,
      )

      const response = await patchMeal({ servings: 6 })

      expect(response.status).toBe(200)
      expect(mealComponentDeleteMany).not.toHaveBeenCalled()
      expect(mealComponentCreateMany).not.toHaveBeenCalled()
      expect(mealUpdate).toHaveBeenCalledWith({
        where: { id: 'meal-1' },
        data: { servings: 6 },
      })
    })
  })

  it('returns 500 with the { error } JSON shape when the transaction throws', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealFindFirst.mockResolvedValue({ ...mockMealResult, deletedAt: null } as never)
    mockTransaction.mockRejectedValue(new Error('db down'))

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated Chicken Bowl' }),
    })
    const response = await PATCH(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(500)
    // `apiFetch` parses the body and surfaces `error` — a bare Next.js 500
    // would not be JSON at all, which is the regression this guards.
    expect(typeof data.error).toBe('string')
    expect(data.error.length).toBeGreaterThan(0)
  })
})

describe('DELETE /api/households/me/meals/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'DELETE',
    })
    const response = await DELETE(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'DELETE',
    })
    const response = await DELETE(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 404 when meal not found', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealFindFirst.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/meals/nonexistent', {
      method: 'DELETE',
    })
    const response = await DELETE(request, { params: paramsPromise('nonexistent') })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Meal not found')
  })

  it('soft deletes meal successfully', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealFindFirst.mockResolvedValue({ ...mockMealResult, deletedAt: null } as never)
    vi.mocked(prisma.meal.update).mockResolvedValue({} as never)

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'DELETE',
    })
    const response = await DELETE(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(vi.mocked(prisma.meal.update)).toHaveBeenCalledWith({
      where: { id: 'meal-1' },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it('returns 500 with the { error } JSON shape when the soft delete throws', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealFindFirst.mockResolvedValue({ ...mockMealResult, deletedAt: null } as never)
    vi.mocked(prisma.meal.update).mockRejectedValue(new Error('db down'))

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'DELETE',
    })
    const response = await DELETE(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(typeof data.error).toBe('string')
    expect(data.error.length).toBeGreaterThan(0)
  })
})
