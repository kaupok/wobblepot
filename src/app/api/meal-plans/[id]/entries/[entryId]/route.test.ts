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
      findFirst: vi.fn(),
    },
    pantryItem: {
      deleteMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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

const mockPantryUpdateMany = vi.mocked(prisma.pantryItem.updateMany)
const mockPantryDeleteMany = vi.mocked(prisma.pantryItem.deleteMany)
const mockPantryUpdate = vi.mocked(prisma.pantryItem.update)

/**
 * The decrement `updateMany` the route issues for one ingredient.
 *
 * Every deduction goes through this shape, so the assertions below only ever
 * have to name the ingredient and the amount. The `isStaple` / `quantity`
 * filters are part of the shape on purpose: they are what replaced the
 * application-side `if (pantryItem.isStaple) continue` and null check, so a
 * regression that drops them has to fail a test.
 */
const decrementOf = (ingredientId: string, amount: number) => ({
  where: {
    householdId: 'household-123',
    ingredientId,
    isStaple: false,
    quantity: { not: null },
  },
  data: { quantity: { decrement: amount } },
})

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
    vi.mocked(prisma.meal.findFirst).mockResolvedValue(mockMeal as never)
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
    vi.mocked(prisma.meal.findFirst).mockResolvedValue(mockMeal as never)
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

    vi.mocked(prisma.$transaction).mockResolvedValue(undefined as never)

    const response = await PATCH(
      createPatchRequest({ status: 'completed', deductPantry: true, servingOverride: 4 }),
      { params: createParams() },
    )

    expect(response.status).toBe(200)
    expect(mockPantryUpdateMany).toHaveBeenCalledWith(decrementOf('ing-1', 400)) // 100 × 4
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
    vi.mocked(prisma.meal.findFirst).mockResolvedValue({
      id: 'new-meal-456',
      components: [{ ingredientId: 'ing-1', quantityPerServing: 100 }],
    } as never)
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
    // 100 × 2 members, not × the reset 6
    expect(mockPantryUpdateMany).toHaveBeenCalledWith(decrementOf('ing-1', 200))
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

    vi.mocked(prisma.meal.findFirst).mockResolvedValue({
      id: 'new-meal-456',
      components: [{ ingredientId: 'ing-fish', quantityPerServing: 150 }],
    } as never)
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
    // Only the new meal's ingredient is touched at all — 150 × 2 members.
    expect(mockPantryUpdateMany).toHaveBeenCalledTimes(1)
    expect(mockPantryUpdateMany).toHaveBeenCalledWith(decrementOf('ing-fish', 300))
    expect(mockPantryDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ingredientId: { in: ['ing-fish'] } }),
      }),
    )
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

    vi.mocked(prisma.meal.findFirst).mockResolvedValue({
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
    expect(mockPantryUpdateMany).not.toHaveBeenCalled()
    expect(mockPantryDeleteMany).not.toHaveBeenCalled()
  })

  it('scopes the swap lookup to meals the household may see', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'old-meal-123',
      plan: {
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)

    // Another household's custom meal: outside the visibility filter, so the
    // scoped lookup finds nothing.
    vi.mocked(prisma.meal.findFirst).mockResolvedValue(null as never)

    const response = await PATCH(createPatchRequest({ mealId: 'foreign-meal-999' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Meal not found')
    expect(vi.mocked(prisma.meal.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'foreign-meal-999',
          deletedAt: null,
          OR: [{ householdId: null }, { householdId: 'household-123' }],
        }),
      }),
    )
    expect(mockUpdateEntry).not.toHaveBeenCalled()
  })

  it('does not deduct a second time for an already completed entry', async () => {
    // Reverting to `planned` does not restock, so re-completing must not
    // charge the pantry again for the one meal that was cooked.
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      status: 'completed',
      servingOverride: null,
      plan: {
        household: { members: [{ id: 'member-1' }, { id: 'member-2' }] },
      },
      meal: {
        components: [{ ingredientId: 'ing-1', quantityPerServing: 100 }],
      },
    } as never)
    mockUpdateEntry.mockResolvedValue({
      id: 'entry-123',
      status: 'completed',
      mealId: 'meal-123',
    } as never)

    const response = await PATCH(createPatchRequest({ status: 'completed', deductPantry: true }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.pantryDeducted).toBeUndefined()
    expect(mockPantryUpdateMany).not.toHaveBeenCalled()
    expect(mockPantryDeleteMany).not.toHaveBeenCalled()
  })

  it('still deducts when re-completing an entry that was reverted to planned', async () => {
    // The guard keys on the stored status, not on the request, so an entry
    // that is back in `planned` is charged normally.
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      status: 'planned',
      servingOverride: null,
      plan: {
        household: { members: [{ id: 'member-1' }, { id: 'member-2' }] },
      },
      meal: {
        components: [{ ingredientId: 'ing-1', quantityPerServing: 100 }],
      },
    } as never)

    vi.mocked(prisma.$transaction).mockResolvedValue(undefined as never)

    const response = await PATCH(createPatchRequest({ status: 'completed', deductPantry: true }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.pantryDeducted).toBe(true)
    expect(mockPantryUpdateMany).toHaveBeenCalledWith(decrementOf('ing-1', 200))
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

    vi.mocked(prisma.meal.findFirst).mockResolvedValue({
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
    expect(mockPantryUpdateMany).not.toHaveBeenCalled()
    expect(mockPantryDeleteMany).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/meal-plans/[id]/entries/[entryId] - atomic pantry deduction', () => {
  // The route used to read each pantry row, subtract in JS, and write the
  // resulting absolute quantity. Two entries sharing an ingredient and
  // completed at the same moment both read the same starting quantity, so the
  // second write silently discarded the first deduction (HON-625). These tests
  // pin the shape that closes it: the database does the arithmetic.
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    vi.mocked(prisma.$transaction).mockResolvedValue(undefined as never)
  })

  const completeWithComponents = (
    components: { ingredientId: string; quantityPerServing: number }[],
    members = [{ id: 'member-1' }, { id: 'member-2' }],
  ) => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      status: 'planned',
      servingOverride: null,
      plan: { household: { members } },
      meal: { components },
    } as never)

    return PATCH(createPatchRequest({ status: 'completed', deductPantry: true }), {
      params: createParams(),
    })
  }

  it('never writes an application-computed absolute quantity', async () => {
    // The acceptance criterion for the race: with 1000g in the pantry, two
    // concurrent completions taking 300g and 200g must land at 500g. Nothing
    // asserted here reads 1000 — that is the point. Because the write is
    // relative, the two decrements compose in the database instead of one
    // overwriting the other with a stale 700 or 800.
    const response = await completeWithComponents([
      { ingredientId: 'ing-1', quantityPerServing: 150 },
    ])

    expect(response.status).toBe(200)
    // No absolute-quantity write survives anywhere: not through the per-row
    // `update` the old code used, and not smuggled into `updateMany.data`.
    expect(mockPantryUpdate).not.toHaveBeenCalled()
    for (const [args] of mockPantryUpdateMany.mock.calls) {
      expect(args.data.quantity).toEqual({ decrement: expect.any(Number) })
    }
    expect(mockPantryUpdateMany).toHaveBeenCalledWith(decrementOf('ing-1', 300))
  })

  it('scopes each decrement to a non-staple, quantified row of this household', async () => {
    // Staples are exempt from deduction and a null quantity means "some,
    // amount unknown" — there is nothing to subtract from. Both used to be
    // application-side branches over the pantry read; they are now `where`
    // filters, which is what let the read go away.
    const response = await completeWithComponents([
      { ingredientId: 'ing-1', quantityPerServing: 100 },
      { ingredientId: 'ing-2', quantityPerServing: 50 },
    ])

    expect(response.status).toBe(200)
    expect(mockPantryUpdateMany).toHaveBeenCalledTimes(2)
    expect(mockPantryUpdateMany).toHaveBeenCalledWith(decrementOf('ing-1', 200))
    expect(mockPantryUpdateMany).toHaveBeenCalledWith(decrementOf('ing-2', 100))
  })

  it('deletes rows the deduction depleted, and unquantified rows, in one cleanup', async () => {
    // Depletion is judged against the post-decrement value, so an overshoot
    // can never be left behind at a negative quantity. `quantity: null` rows
    // are skipped by the decrement above and swept up here instead.
    const response = await completeWithComponents([
      { ingredientId: 'ing-1', quantityPerServing: 100 },
      { ingredientId: 'ing-2', quantityPerServing: 50 },
    ])

    expect(response.status).toBe(200)
    expect(mockPantryDeleteMany).toHaveBeenCalledTimes(1)
    expect(mockPantryDeleteMany).toHaveBeenCalledWith({
      where: {
        householdId: 'household-123',
        ingredientId: { in: ['ing-1', 'ing-2'] },
        isStaple: false,
        OR: [{ quantity: null }, { quantity: { lte: 0 } }],
      },
    })
  })

  it('runs the depletion cleanup after every decrement, inside one transaction', async () => {
    // `prisma.$transaction([...])` executes its array in order, and the array
    // is built in call order — so a cleanup that ran before the decrements
    // would judge depletion against the pre-deduction quantity and leave
    // emptied rows in the pantry.
    const response = await completeWithComponents([
      { ingredientId: 'ing-1', quantityPerServing: 100 },
      { ingredientId: 'ing-2', quantityPerServing: 50 },
    ])

    expect(response.status).toBe(200)
    const pantryOps = [
      ...mockPantryUpdateMany.mock.invocationCallOrder.map((order) => ({ order, op: 'decrement' })),
      ...mockPantryDeleteMany.mock.invocationCallOrder.map((order) => ({ order, op: 'cleanup' })),
    ].sort((a, b) => a.order - b.order)

    expect(pantryOps.map((entry) => entry.op)).toEqual(['decrement', 'decrement', 'cleanup'])
    // Entry update + one decrement per ingredient + the single cleanup, all
    // handed to one transaction — no pantry write escapes it.
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.$transaction).mock.lastCall?.[0]).toHaveLength(4)
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
