import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PATCH, DELETE } from './route'

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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mealPlanEntry: {
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    meal: {
      findUnique: vi.fn(),
    },
    pantryItem: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockFindFirstEntry = vi.mocked(prisma.mealPlanEntry.findFirst)
const mockUpdateEntry = vi.mocked(prisma.mealPlanEntry.update)
const mockDeleteEntry = vi.mocked(prisma.mealPlanEntry.delete)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: { id: 'household-123', name: 'Test', timezone: 'Europe/Tallinn' },
} as never

const createPatchRequest = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/meal-plans/plan-123/entries/entry-123', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

const createDeleteRequest = () =>
  new Request('http://localhost/api/meal-plans/plan-123/entries/entry-123', {
    method: 'DELETE',
  })

const createParams = () => Promise.resolve({ id: 'plan-123', entryId: 'entry-123' })

describe('PATCH /api/meal-plans/[id]/entries/[entryId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
  })

  it('allows status change to completed', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)
    mockUpdateEntry.mockResolvedValue({
      id: 'entry-123',
      status: 'completed',
      mealId: 'meal-123',
    } as never)

    const response = await PATCH(createPatchRequest({ status: 'completed' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.status).toBe('completed')
  })

  it('allows status change to skipped', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)
    mockUpdateEntry.mockResolvedValue({
      id: 'entry-123',
      status: 'skipped',
      mealId: 'meal-123',
    } as never)

    const response = await PATCH(createPatchRequest({ status: 'skipped' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.status).toBe('skipped')
  })

  it('allows meal swap', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)

    const mockMeal = { id: 'new-meal-456' }
    vi.mocked(prisma.meal.findUnique).mockResolvedValue(mockMeal as never)
    mockUpdateEntry.mockResolvedValue({
      id: 'entry-123',
      status: 'planned',
      mealId: 'new-meal-456',
    } as never)

    const response = await PATCH(createPatchRequest({ mealId: 'new-meal-456' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.mealId).toBe('new-meal-456')
  })

  it('allows meal swap combined with status change', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)

    const mockMeal = { id: 'new-meal-456' }
    vi.mocked(prisma.meal.findUnique).mockResolvedValue(mockMeal as never)
    mockUpdateEntry.mockResolvedValue({
      id: 'entry-123',
      status: 'completed',
      mealId: 'new-meal-456',
    } as never)

    const response = await PATCH(
      createPatchRequest({ status: 'completed', mealId: 'new-meal-456' }),
      { params: createParams() },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.mealId).toBe('new-meal-456')
  })

  it('allows pantry deduction when completing entries', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        household: { members: [{ id: 'member-1' }] },
      },
      meal: {
        components: [{ ingredientId: 'ing-1', quantityPerServing: 100 }],
      },
    } as never)

    vi.mocked(prisma.pantryItem.findMany).mockResolvedValue([
      { id: 'pantry-1', ingredientId: 'ing-1', quantity: 500, isStaple: false },
    ] as never)

    vi.mocked(prisma.$transaction).mockResolvedValue(undefined as never)

    const response = await PATCH(createPatchRequest({ status: 'completed', deductPantry: true }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.status).toBe('completed')
    expect(data.pantryDeducted).toBe(true)
  })

  it('deducts using the servingOverride sent in the same request, not the stored one', async () => {
    // Entry is stored at 2 servings; this request persists 4 *and* completes
    // the entry in one transaction. Deducting off the pre-update snapshot
    // would take 100 × 2 = 200g and leave the pantry 200g overstated.
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      servingOverride: 2,
      plan: {
        household: { members: [{ id: 'member-1' }, { id: 'member-2' }] },
      },
      meal: {
        components: [{ ingredientId: 'ing-1', quantityPerServing: 100 }],
      },
    } as never)

    vi.mocked(prisma.pantryItem.findMany).mockResolvedValue([
      { id: 'pantry-1', ingredientId: 'ing-1', quantity: 1000, isStaple: false },
    ] as never)
    vi.mocked(prisma.$transaction).mockResolvedValue(undefined as never)

    const response = await PATCH(
      createPatchRequest({ status: 'completed', deductPantry: true, servingOverride: 4 }),
      { params: createParams() },
    )

    expect(response.status).toBe(200)
    expect(vi.mocked(prisma.pantryItem.update)).toHaveBeenCalledWith({
      where: { id: 'pantry-1' },
      data: { quantity: 600 }, // 1000 - 100 × 4
    })
  })

  it('deducts using the household size when a meal swap resets the override', async () => {
    // A swap sets `servingOverride: null` in the same update, so the stored
    // override must not survive into the deduction.
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      servingOverride: 6,
      plan: {
        household: { members: [{ id: 'member-1' }, { id: 'member-2' }] },
      },
      meal: {
        components: [{ ingredientId: 'ing-1', quantityPerServing: 100 }],
      },
    } as never)

    // The incoming meal carries the same component, so this test isolates the
    // serving count — the deduction reads the swap target's components (HON-622).
    vi.mocked(prisma.meal.findUnique).mockResolvedValue({
      id: 'new-meal-456',
      components: [{ ingredientId: 'ing-1', quantityPerServing: 100 }],
    } as never)
    vi.mocked(prisma.pantryItem.findMany).mockResolvedValue([
      { id: 'pantry-1', ingredientId: 'ing-1', quantity: 1000, isStaple: false },
    ] as never)
    vi.mocked(prisma.$transaction).mockResolvedValue(undefined as never)

    const response = await PATCH(
      createPatchRequest({
        status: 'completed',
        deductPantry: true,
        mealId: 'new-meal-456',
      }),
      { params: createParams() },
    )

    expect(response.status).toBe(200)
    expect(vi.mocked(prisma.pantryItem.update)).toHaveBeenCalledWith({
      where: { id: 'pantry-1' },
      data: { quantity: 800 }, // 1000 - 100 × 2 members, not × the reset 6
    })
  })

  it('deducts the incoming meal on a swap, not the meal the entry was read with', async () => {
    // Swap + complete + deduct in one request. The entry still points at the
    // old meal when it is read, so deducting off that snapshot would charge
    // the household for beef it never cooked and leave the fish in the pantry.
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'old-meal-123',
      servingOverride: null,
      plan: {
        household: { members: [{ id: 'member-1' }, { id: 'member-2' }] },
      },
      meal: {
        components: [{ ingredientId: 'ing-beef', quantityPerServing: 100 }],
      },
    } as never)

    vi.mocked(prisma.meal.findUnique).mockResolvedValue({
      id: 'new-meal-456',
      components: [{ ingredientId: 'ing-fish', quantityPerServing: 150 }],
    } as never)
    vi.mocked(prisma.pantryItem.findMany).mockResolvedValue([
      { id: 'pantry-fish', ingredientId: 'ing-fish', quantity: 1000, isStaple: false },
    ] as never)
    vi.mocked(prisma.$transaction).mockResolvedValue(undefined as never)

    const response = await PATCH(
      createPatchRequest({
        status: 'completed',
        deductPantry: true,
        mealId: 'new-meal-456',
      }),
      { params: createParams() },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.pantryDeducted).toBe(true)
    // Only the new meal's ingredient is even looked up in the pantry.
    expect(vi.mocked(prisma.pantryItem.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ingredientId: { in: ['ing-fish'] } }),
      }),
    )
    expect(vi.mocked(prisma.pantryItem.update)).toHaveBeenCalledWith({
      where: { id: 'pantry-fish' },
      data: { quantity: 700 }, // 1000 - 150 × 2 members
    })
  })

  it('deducts nothing when the swap target has no components', async () => {
    // The old meal has components and the new one does not: there is nothing
    // to charge for, so the request falls through to the plain update.
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'old-meal-123',
      servingOverride: null,
      plan: {
        household: { members: [{ id: 'member-1' }] },
      },
      meal: {
        components: [{ ingredientId: 'ing-beef', quantityPerServing: 100 }],
      },
    } as never)

    vi.mocked(prisma.meal.findUnique).mockResolvedValue({
      id: 'new-meal-456',
      components: [],
    } as never)
    mockUpdateEntry.mockResolvedValue({
      id: 'entry-123',
      status: 'completed',
      mealId: 'new-meal-456',
    } as never)

    const response = await PATCH(
      createPatchRequest({
        status: 'completed',
        deductPantry: true,
        mealId: 'new-meal-456',
      }),
      { params: createParams() },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.pantryDeducted).toBeUndefined()
    expect(vi.mocked(prisma.pantryItem.findMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.pantryItem.update)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.pantryItem.deleteMany)).not.toHaveBeenCalled()
  })

  it('leaves the pantry untouched when a swap omits deductPantry', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'old-meal-123',
      servingOverride: null,
      plan: {
        household: { members: [{ id: 'member-1' }, { id: 'member-2' }] },
      },
      meal: {
        components: [{ ingredientId: 'ing-beef', quantityPerServing: 100 }],
      },
    } as never)

    vi.mocked(prisma.meal.findUnique).mockResolvedValue({
      id: 'new-meal-456',
      components: [{ ingredientId: 'ing-fish', quantityPerServing: 150 }],
    } as never)
    mockUpdateEntry.mockResolvedValue({
      id: 'entry-123',
      status: 'completed',
      mealId: 'new-meal-456',
    } as never)

    const response = await PATCH(
      createPatchRequest({ status: 'completed', mealId: 'new-meal-456' }),
      { params: createParams() },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.mealId).toBe('new-meal-456')
    expect(data.pantryDeducted).toBeUndefined()
    expect(vi.mocked(prisma.pantryItem.findMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.pantryItem.update)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.pantryItem.deleteMany)).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/meal-plans/[id]/entries/[entryId] - rating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
  })

  it('allows rating update', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)
    mockUpdateEntry.mockResolvedValue({
      id: 'entry-123',
      status: 'completed',
      mealId: 'meal-123',
      rating: 'up',
    } as never)

    const response = await PATCH(createPatchRequest({ rating: 'up' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.rating).toBe('up')
  })

  it('allows clearing rating with null', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)
    mockUpdateEntry.mockResolvedValue({
      id: 'entry-123',
      status: 'completed',
      mealId: 'meal-123',
      rating: null,
    } as never)

    const response = await PATCH(createPatchRequest({ rating: null }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.rating).toBeNull()
  })

  it('rejects invalid rating values', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)

    const response = await PATCH(createPatchRequest({ rating: 'invalid' }), {
      params: createParams(),
    })

    expect(response.status).toBe(400)
  })
})

describe('DELETE /api/meal-plans/[id]/entries/[entryId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
  })

  it('allows deletion of entries', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
    } as never)
    mockDeleteEntry.mockResolvedValue({ id: 'entry-123' } as never)

    const response = await DELETE(createDeleteRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })
})
