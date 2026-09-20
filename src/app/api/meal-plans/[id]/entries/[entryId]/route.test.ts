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
      updateMany: vi.fn(),
      updateManyAndReturn: vi.fn(),
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

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
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
 * Both conditional writes the route makes go through `updateManyAndReturn`,
 * and never in the same request: the deduction transaction's completion claim,
 * and the non-deducting swap. Each re-tests the entry's status as part of the
 * write, because the `status` the handler read at the top is from before the
 * meal lookup and a concurrent request can land in between (HON-633). The
 * claim also re-tests `pantryDeductedAt`, which it sets (HON-651). Both
 * return an array — empty when nothing matched.
 */
const mockClaimEntry = vi.mocked(prisma.mealPlanEntry.updateManyAndReturn)
const mockSwapEntry = mockClaimEntry

/** The row a matched conditional write returns, as `updateManyAndReturn` does. */
const swapReturns = (row: Record<string, unknown>) =>
  mockSwapEntry.mockResolvedValue([row] as never)

/** The unconditional `updateMany` the lost-race branch falls back to. */
const mockFallbackWrite = vi.mocked(prisma.mealPlanEntry.updateMany)

/**
 * Writes the route issued while the transaction callback was NOT on the stack.
 * Must stay empty: a pantry write outside the transaction is not rolled back
 * with the rest of the completion.
 *
 * Reset by every `mockDeductionTransaction()` call.
 */
let writesOutsideTransaction: string[] = []

/**
 * Run the deduction's interactive transaction against the same `prisma` mock,
 * so `tx.pantryItem.updateMany` and `prisma.pantryItem.updateMany` are one
 * spy and the assertions below can read the calls the route made inside it.
 *
 * Sharing the spy is what makes the calls visible, but it also means call
 * *count* alone cannot tell a write inside the transaction from one outside —
 * `expect($transaction).toHaveBeenCalledTimes(1)` would pass either way. So
 * each write records whether the callback was on the stack when it ran, and
 * `writesOutsideTransaction` carries the ones that escaped.
 *
 * `claimedCount` is what the conditional entry claim reports: 1 when this
 * request won the completion, 0 when a concurrent one got there first.
 *
 * `claimedMealId` is the `mealId` on the row the claim hands back. It defaults
 * to the one the fixtures below read the entry with, so the route's staleness
 * check passes; a test that wants to model a swap committing mid-flight passes
 * a different one.
 */
const mockDeductionTransaction = (
  claimedCount = 1,
  claimedMealId = 'meal-123',
  claimedServingOverride: number | null = null,
) => {
  writesOutsideTransaction = []
  let insideTransaction = false

  const record = <T>(op: string, result: T) => {
    if (!insideTransaction) writesOutsideTransaction.push(op)
    return Promise.resolve(result)
  }

  const claimedRows =
    claimedCount === 0
      ? []
      : [
          {
            id: 'entry-123',
            status: 'completed',
            mealId: claimedMealId,
            servingOverride: claimedServingOverride,
          },
        ]

  mockClaimEntry.mockImplementation((() => record('claim', claimedRows)) as never)
  mockFallbackWrite.mockImplementation((() => record('fallback', { count: claimedCount })) as never)
  mockPantryUpdateMany.mockImplementation((() => record('decrement', { count: 1 })) as never)
  mockPantryDeleteMany.mockImplementation((() => record('cleanup', { count: 0 })) as never)

  vi.mocked(prisma.$transaction).mockImplementation((async (
    run: (tx: typeof prisma) => Promise<unknown>,
  ) => {
    insideTransaction = true
    try {
      return await run(prisma)
    } finally {
      insideTransaction = false
    }
  }) as never)
}

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
    swapReturns({ id: 'entry-123', status: 'planned', mealId: 'new-meal-456' })

    const response = await PATCH(createPatchRequest({ mealId: 'new-meal-456' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.mealId).toBe('new-meal-456')
    // The write carries the status condition, so a completion that commits
    // between the read and this write matches nothing (HON-633).
    expect(mockSwapEntry).toHaveBeenCalledWith({
      where: { id: 'entry-123', status: { not: 'completed' } },
      data: expect.objectContaining({ mealId: 'new-meal-456' }),
    })
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
    swapReturns({ id: 'entry-123', status: 'completed', mealId: 'new-meal-456' })

    const response = await PATCH(
      createPatchRequest({ status: 'completed', mealId: 'new-meal-456' }),
      { params: createParams() },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.mealId).toBe('new-meal-456')
  })

  it('rejects a meal swap on an already-completed entry', async () => {
    // A completed entry records what was cooked and what the pantry was
    // charged for. Repointing it would leave the entry naming one meal while
    // the pantry paid for another — HON-622's invariant, reached from the
    // other side (HON-633).
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      status: 'completed',
      servingOverride: null,
      plan: {
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)

    const response = await PATCH(createPatchRequest({ mealId: 'new-meal-456' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Cannot swap a completed meal')
    // Nothing written, and the guard short-circuits before the meal lookup.
    expect(mockUpdateEntry).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.meal.findFirst)).not.toHaveBeenCalled()
  })

  it('rejects a swap-and-complete on an already-completed entry', async () => {
    // `status` + `deductPantry` cannot rescue the swap: the deduction guard
    // refuses to charge an already-completed entry a second time, so this
    // body would persist a meal it never paid for (HON-633).
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

    const response = await PATCH(
      createPatchRequest({ mealId: 'new-meal-456', status: 'completed', deductPantry: true }),
      { params: createParams() },
    )
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Cannot swap a completed meal')
    expect(mockUpdateEntry).not.toHaveBeenCalled()
    expect(mockClaimEntry).not.toHaveBeenCalled()
    expect(mockPantryUpdateMany).not.toHaveBeenCalled()
    expect(mockPantryDeleteMany).not.toHaveBeenCalled()
  })

  it('rejects a swap that raced a concurrent completion', async () => {
    // The shape `MealSelectorModal` actually sends: `{ mealId }` alone, which
    // never enters the deduction transaction, so the conditional claim there
    // does not cover it. The entry read `planned`, so the guard at the top of
    // the handler passed — and a concurrent request committed `completed` (and
    // charged the pantry for the meal the entry named then) before this write
    // landed. The condition on the write itself is what catches it (HON-633).
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      status: 'planned',
      servingOverride: null,
      plan: {
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)

    vi.mocked(prisma.meal.findFirst).mockResolvedValue({
      id: 'new-meal-456',
      components: [],
    } as never)
    // No row matched the `status: { not: 'completed' }` condition.
    mockSwapEntry.mockResolvedValue([] as never)

    const response = await PATCH(createPatchRequest({ mealId: 'new-meal-456' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Cannot swap a completed meal')
    expect(mockUpdateEntry).not.toHaveBeenCalled()
  })

  it('still swaps a skipped entry', async () => {
    // Nothing was deducted for a skipped meal, so there is no pantry charge to
    // disagree with — swapping one is a legitimate "actually, let's cook
    // something" path and stays allowed (HON-633).
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      status: 'skipped',
      servingOverride: null,
      plan: {
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)

    vi.mocked(prisma.meal.findFirst).mockResolvedValue({
      id: 'new-meal-456',
      components: [],
    } as never)
    swapReturns({ id: 'entry-123', status: 'skipped', mealId: 'new-meal-456' })

    const response = await PATCH(createPatchRequest({ mealId: 'new-meal-456' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.mealId).toBe('new-meal-456')
  })

  it('still reports an unexpected failure as a 500', async () => {
    // The swap refusal is signalled by throwing, so the outer `catch` now
    // branches on the error type. Everything that is not that sentinel must
    // still be captured and answered with a 500 — the branch must not widen
    // into "any throw means 409" (HON-633).
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      status: 'planned',
      servingOverride: null,
      plan: {
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)
    mockUpdateEntry.mockRejectedValue(new Error('connection lost') as never)

    const response = await PATCH(createPatchRequest({ status: 'skipped' }), {
      params: createParams(),
    })

    expect(response.status).toBe(500)
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })

  it('allows pantry deduction when completing entries', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      servingOverride: null,
      pantryDeductedAt: null,
      plan: {
        household: { members: [{ id: 'member-1' }] },
      },
      meal: {
        components: [{ ingredientId: 'ing-1', quantityPerServing: 100 }],
      },
    } as never)

    mockDeductionTransaction()

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
      pantryDeductedAt: null,
      plan: {
        household: { members: [{ id: 'member-1' }, { id: 'member-2' }] },
      },
      meal: {
        components: [{ ingredientId: 'ing-1', quantityPerServing: 100 }],
      },
    } as never)

    mockDeductionTransaction()

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
      pantryDeductedAt: null,
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
    mockDeductionTransaction()

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
      pantryDeductedAt: null,
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
    mockDeductionTransaction()

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
        where: expect.objectContaining({ ingredientId: 'ing-fish' }),
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
    swapReturns({ id: 'entry-123', status: 'completed', mealId: 'new-meal-456' })

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
    expect(mockSwapEntry).not.toHaveBeenCalled()
  })

  it('does not deduct a second time for an already completed entry', async () => {
    // A repeated `completed` — a double submit, a client retry. The marker is
    // null on purpose: an entry completed without deducting, or a row the
    // migration's backfill could not reach, must still be refused by the
    // status check alone (HON-651).
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      status: 'completed',
      servingOverride: null,
      pantryDeductedAt: null,
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

  it('does not deduct again when re-completing an entry that was reverted to planned', async () => {
    // Reverting to `planned` does not restock — the food was cooked — so the
    // marker the first completion set is what keeps the re-completion from
    // charging the pantry a second time. The stored status alone reads
    // `planned` here and cannot tell (HON-651).
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      status: 'planned',
      servingOverride: null,
      pantryDeductedAt: new Date('2026-09-01T18:00:00Z'),
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
    expect(data.status).toBe('completed')
    expect(data.pantryDeducted).toBeUndefined()
    expect(mockClaimEntry).not.toHaveBeenCalled()
    expect(mockPantryUpdateMany).not.toHaveBeenCalled()
    expect(mockPantryDeleteMany).not.toHaveBeenCalled()
    // The completion itself is still persisted, and the marker is left alone.
    expect(mockUpdateEntry).toHaveBeenCalledWith({
      where: { id: 'entry-123' },
      data: { status: 'completed' },
    })
  })

  it('charges the pantry once across complete → revert → complete', async () => {
    // The whole round trip against one stateful row, so the marker the first
    // request writes is the one the third request reads. The fake claim honours
    // the `where` the route actually sends, so a regression that stops
    // claiming on the marker (or stops setting it) deducts twice here.
    const row: Record<string, unknown> = {
      id: 'entry-123',
      mealId: 'meal-123',
      status: 'planned',
      servingOverride: null,
      pantryDeductedAt: null,
    }
    mockDeductionTransaction()
    mockFindFirstEntry.mockImplementation((async () => ({
      ...row,
      plan: { household: { members: [{ id: 'member-1' }, { id: 'member-2' }] } },
      meal: { components: [{ ingredientId: 'ing-1', quantityPerServing: 100 }] },
    })) as never)
    mockClaimEntry.mockImplementation((async ({
      where,
      data,
    }: {
      where: { status?: { not: string }; pantryDeductedAt?: null }
      data: Record<string, unknown>
    }) => {
      const statusMatches = !where.status || row.status !== where.status.not
      const markerMatches = !('pantryDeductedAt' in where) || row.pantryDeductedAt === null
      if (!statusMatches || !markerMatches) return []
      Object.assign(row, data)
      return [{ ...row }]
    }) as never)
    mockUpdateEntry.mockImplementation((async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(row, data)
      return { ...row }
    }) as never)

    const complete = () =>
      PATCH(createPatchRequest({ status: 'completed', deductPantry: true }), {
        params: createParams(),
      })

    const first = await complete()
    expect((await first.json()).pantryDeducted).toBe(true)
    expect(row.pantryDeductedAt).toBeInstanceOf(Date)

    const revert = await PATCH(createPatchRequest({ status: 'planned' }), {
      params: createParams(),
    })
    expect(revert.status).toBe(200)
    expect(row.status).toBe('planned')
    // Nothing clears the marker — not a revert.
    expect(row.pantryDeductedAt).toBeInstanceOf(Date)

    const second = await complete()
    expect(second.status).toBe(200)
    expect((await second.json()).pantryDeducted).toBeUndefined()
    expect(row.status).toBe('completed')

    expect(mockPantryUpdateMany).toHaveBeenCalledTimes(1)
    expect(mockPantryUpdateMany).toHaveBeenCalledWith(decrementOf('ing-1', 200))
  })

  it('neither deducts nor sets pantryDeductedAt when deductPantry is false', async () => {
    // Completing without deducting charges nothing, so it must not record a
    // charge either — otherwise a later revert and deducting completion would
    // be refused for a pantry that was never touched.
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      status: 'planned',
      servingOverride: null,
      pantryDeductedAt: null,
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

    const response = await PATCH(createPatchRequest({ status: 'completed', deductPantry: false }), {
      params: createParams(),
    })

    expect(response.status).toBe(200)
    expect(mockClaimEntry).not.toHaveBeenCalled()
    expect(mockPantryUpdateMany).not.toHaveBeenCalled()
    expect(mockPantryDeleteMany).not.toHaveBeenCalled()
    const [[{ data }]] = mockUpdateEntry.mock.calls as unknown as [[{ data: object }]]
    expect(data).not.toHaveProperty('pantryDeductedAt')
  })

  it('leaves pantryDeductedAt in place on a swap after a revert, and charges neither meal', async () => {
    // Swapping is allowed again once the entry is back in `planned`, but the
    // original meal's ingredients were consumed. Charging the incoming meal on
    // re-completion would be the same double-charge from another door, so the
    // swap neither clears the marker nor deducts — even with `deductPantry`.
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'old-meal-123',
      status: 'planned',
      servingOverride: null,
      pantryDeductedAt: new Date('2026-09-01T18:00:00Z'),
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
    swapReturns({ id: 'entry-123', status: 'completed', mealId: 'new-meal-456' })

    const response = await PATCH(
      createPatchRequest({ mealId: 'new-meal-456', status: 'completed', deductPantry: true }),
      { params: createParams() },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.mealId).toBe('new-meal-456')
    expect(data.pantryDeducted).toBeUndefined()
    expect(vi.mocked(prisma.$transaction)).not.toHaveBeenCalled()
    expect(mockPantryUpdateMany).not.toHaveBeenCalled()
    expect(mockPantryDeleteMany).not.toHaveBeenCalled()
    // Taken through the non-deducting swap write, whose data never names the
    // marker — so the stored value survives.
    expect(mockSwapEntry).toHaveBeenCalledTimes(1)
    const [[{ data: written }]] = mockSwapEntry.mock.calls as unknown as [[{ data: object }]]
    expect(written).toEqual(expect.objectContaining({ mealId: 'new-meal-456' }))
    expect(written).not.toHaveProperty('pantryDeductedAt')
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
    swapReturns({ id: 'entry-123', status: 'completed', mealId: 'new-meal-456' })

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
    mockDeductionTransaction()
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
      pantryDeductedAt: null,
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

  it('deletes rows the deduction depleted, and unquantified rows, one row per statement', async () => {
    // Depletion is judged against the post-decrement value, so an overshoot
    // can never be left behind at a negative quantity. `quantity: null` rows
    // are skipped by the decrement above and swept up here instead.
    //
    // One statement per row, not one `deleteMany` over an `IN` list: a
    // multi-row DELETE lets Postgres choose the lock order, and a
    // `quantity: null` row takes no lock in the decrement loop, so this is
    // where it is locked for the first time (HON-632).
    const response = await completeWithComponents([
      { ingredientId: 'ing-1', quantityPerServing: 100 },
      { ingredientId: 'ing-2', quantityPerServing: 50 },
    ])

    expect(response.status).toBe(200)
    expect(mockPantryDeleteMany).toHaveBeenCalledTimes(2)
    for (const ingredientId of ['ing-1', 'ing-2']) {
      expect(mockPantryDeleteMany).toHaveBeenCalledWith({
        where: {
          householdId: 'household-123',
          ingredientId,
          isStaple: false,
          OR: [{ quantity: null }, { quantity: { lte: 0 } }],
        },
      })
    }
  })

  it('claims the completion with a conditional write before deducting', async () => {
    // `shouldDeductPantry` tests a `status` read outside any transaction, so
    // on its own it cannot stop two concurrent completions of the same entry
    // (double submit, two tabs, a client retry) from both deducting. The
    // conditional claim is what makes the loser a no-op.
    const response = await completeWithComponents([
      { ingredientId: 'ing-1', quantityPerServing: 100 },
    ])

    expect(response.status).toBe(200)
    expect(mockClaimEntry).toHaveBeenCalledWith({
      where: { id: 'entry-123', status: { not: 'completed' }, pantryDeductedAt: null },
      data: expect.objectContaining({ status: 'completed' }),
    })
  })

  it('sets pantryDeductedAt in the same statement that claims the completion', async () => {
    // The marker is the stored fact that the entry was charged, so it has to
    // commit exactly when the decrements do. Writing it with the claim puts it
    // inside the transaction, where every rollback path takes it back out
    // together with the charge (HON-651).
    const response = await completeWithComponents([
      { ingredientId: 'ing-1', quantityPerServing: 100 },
    ])

    expect(response.status).toBe(200)
    expect(mockClaimEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'completed', pantryDeductedAt: expect.any(Date) }),
      }),
    )
    expect(writesOutsideTransaction).toEqual([])
  })

  it('rolls the completion back when a concurrent swap moved the meal', async () => {
    // The mirror of the lost completion, and the reason the claim returns its
    // row: this request priced meal-123's components, a swap committed
    // meal-999 before the claim, and the row that comes back names the meal
    // that is actually there. Charging meal-123 would take food that was never
    // cooked; completing without charging would silently under-charge a meal
    // that was. So neither happens — the claim is rolled back and the caller
    // retries (HON-633).
    mockDeductionTransaction(1, 'meal-999')

    const response = await completeWithComponents([
      { ingredientId: 'ing-beef', quantityPerServing: 100 },
    ])
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('The meal changed while completing. Try again.')
    expect(mockPantryUpdateMany).not.toHaveBeenCalled()
    expect(mockPantryDeleteMany).not.toHaveBeenCalled()
    // The completion is undone by the rollback, not by a compensating write.
    expect(mockFallbackWrite).not.toHaveBeenCalled()
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('completes normally when the claimed row still names the meal that was priced', async () => {
    // The counterpart: without it, the test above would pass just as well on a
    // route that 409s every completion.
    const response = await completeWithComponents([
      { ingredientId: 'ing-beef', quantityPerServing: 100 },
    ])
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.pantryDeducted).toBe(true)
    expect(mockPantryUpdateMany).toHaveBeenCalledWith(decrementOf('ing-beef', 200))
  })

  it('exempts a swap-and-complete from the staleness check', async () => {
    // A swap prices the *incoming* meal, which does not depend on what the
    // entry pointed at — so a claimed row naming something else is not stale,
    // it is just the swap this request is performing (HON-633).
    mockDeductionTransaction(1, 'new-meal-456')
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'old-meal-123',
      status: 'planned',
      servingOverride: null,
      pantryDeductedAt: null,
      plan: { household: { members: [{ id: 'member-1' }] } },
      meal: { components: [{ ingredientId: 'ing-beef', quantityPerServing: 100 }] },
    } as never)
    vi.mocked(prisma.meal.findFirst).mockResolvedValue({
      id: 'new-meal-456',
      components: [{ ingredientId: 'ing-fish', quantityPerServing: 150 }],
    } as never)

    const response = await PATCH(
      createPatchRequest({ mealId: 'new-meal-456', status: 'completed', deductPantry: true }),
      { params: createParams() },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.pantryDeducted).toBe(true)
    expect(mockPantryUpdateMany).toHaveBeenCalledWith(decrementOf('ing-fish', 150))
  })

  it('charges nothing when a concurrent request already claimed the completion', async () => {
    // The claim matched no row, so another transaction committed `completed`
    // first and has already charged the pantry. This request still persists
    // its update — the same outcome as arriving after the winner committed
    // and reading `completed` at the top of the handler.
    mockDeductionTransaction(0)

    const response = await completeWithComponents([
      { ingredientId: 'ing-1', quantityPerServing: 100 },
    ])
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.pantryDeducted).toBe(false)
    expect(mockPantryUpdateMany).not.toHaveBeenCalled()
    expect(mockPantryDeleteMany).not.toHaveBeenCalled()
    // Written with `updateMany`, not `update`: a zero-row claim also covers a
    // concurrently deleted entry, and `update` would throw P2025 there and
    // turn a lost race into a 500.
    expect(mockUpdateEntry).not.toHaveBeenCalled()
    expect(mockFallbackWrite).toHaveBeenCalledWith({
      where: { id: 'entry-123' },
      data: expect.objectContaining({ status: 'completed' }),
    })
  })

  it('refuses the swap and persists nothing when the completion was already claimed', async () => {
    // Same rule as the serial guard, reached by losing the race instead of by
    // reading `completed` at the top: this request charges nothing, so it must
    // not repoint the entry at a meal the pantry never paid for (HON-633).
    // Throwing rolls the transaction back, so not even the non-`mealId` fields
    // survive.
    //
    // The deleted-entry sub-case of `claimed.count === 0` answers 409 here
    // too, not 404 — the branch cannot tell the two apart without another
    // read, and the swap is refused either way.
    mockDeductionTransaction(0)
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'old-meal-123',
      status: 'planned',
      servingOverride: null,
      pantryDeductedAt: null,
      plan: { household: { members: [{ id: 'member-1' }, { id: 'member-2' }] } },
      meal: { components: [{ ingredientId: 'ing-beef', quantityPerServing: 100 }] },
    } as never)
    vi.mocked(prisma.meal.findFirst).mockResolvedValue({
      id: 'new-meal-456',
      components: [{ ingredientId: 'ing-fish', quantityPerServing: 150 }],
    } as never)

    const response = await PATCH(
      createPatchRequest({ mealId: 'new-meal-456', status: 'completed', deductPantry: true }),
      { params: createParams() },
    )
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Cannot swap a completed meal')
    // Only the conditional claim ran — the lost-race fallback `updateMany`
    // that persists the rest of the update never fired.
    expect(mockClaimEntry).toHaveBeenCalledTimes(1)
    expect(mockUpdateEntry).not.toHaveBeenCalled()
    expect(mockPantryUpdateMany).not.toHaveBeenCalled()
    expect(mockPantryDeleteMany).not.toHaveBeenCalled()
    // The refusal travels as a thrown sentinel through the handler's outer
    // `catch`, so it has to be recognised there rather than reported as a
    // route failure and answered with a 500.
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('locks pantry rows in a deterministic order across meals', async () => {
    // `meal.components` has no `orderBy`, so two meals sharing ingredients can
    // list them in opposite orders. Two completions taking the same rows in
    // opposite orders deadlock (Postgres 40P01), which surfaces as a 500 and
    // rolls the completion back — so the route sorts before locking.
    const response = await completeWithComponents([
      { ingredientId: 'ing-onion', quantityPerServing: 100 },
      { ingredientId: 'ing-garlic', quantityPerServing: 50 },
    ])

    expect(response.status).toBe(200)
    expect(mockPantryUpdateMany.mock.calls.map(([args]) => args.where?.ingredientId)).toEqual([
      'ing-garlic',
      'ing-onion',
    ])
  })

  it('orders the locks by code unit, not by a locale-aware collation', async () => {
    // The lock order only has to be *identical* in every process — a
    // locale-aware collation is not. `localeCompare` with no locale argument
    // resolves the runtime's default, and the defaults disagree: Estonian
    // sorts `z` between `s` and `t`, so `et` and `en-US` order a base36 cuid
    // pair like `…z…` / `…t…` differently. Two runtimes disagreeing
    // reintroduces the deadlock the sort exists to prevent.
    //
    // The pair below is chosen so a revert to `localeCompare` fails here even
    // under a single runtime: by code unit `Z` (90) precedes `a` (97), while
    // every locale-aware collation compares letters case-insensitively first
    // and puts `apple` before `Zucchini`.
    expect('ing-Zucchini'.localeCompare('ing-apple')).toBe(1)

    const response = await completeWithComponents([
      { ingredientId: 'ing-apple', quantityPerServing: 100 },
      { ingredientId: 'ing-Zucchini', quantityPerServing: 50 },
    ])

    expect(response.status).toBe(200)
    expect(mockPantryUpdateMany.mock.calls.map(([args]) => args.where?.ingredientId)).toEqual([
      'ing-Zucchini',
      'ing-apple',
    ])
  })

  it('takes the cleanup locks in the same sorted order as the decrements', async () => {
    // The decrement loop filters `quantity: { not: null }`, so a row at
    // `quantity: null` matches nothing there and takes no lock — the cleanup
    // is where it is locked for the first time. `quantity: null` is exactly
    // the state both purchase routes create rows in, so a bulk "mark
    // purchased" sorting its own locks is racing *these* statements. A single
    // `deleteMany` over an `IN` list would hand the order to Postgres and
    // reopen the deadlock (HON-632).
    const response = await completeWithComponents([
      { ingredientId: 'ing-apple', quantityPerServing: 100 },
      { ingredientId: 'ing-Zucchini', quantityPerServing: 50 },
    ])

    expect(response.status).toBe(200)
    expect(mockPantryDeleteMany.mock.calls.map(([args]) => args?.where?.ingredientId)).toEqual([
      'ing-Zucchini',
      'ing-apple',
    ])
  })

  it('takes every pantry row lock in one sorted pass, whichever statement takes it', async () => {
    // The invariant is about the order locks are *acquired* in, so it has to
    // hold across both statement kinds together. Sorting the decrements and
    // sorting the sweeps is not enough: the decrement filters
    // `quantity: { not: null }`, so a `quantity: null` row takes no lock there
    // and would be locked only in a later sweep pass — after every quantified
    // row is held, which inverts the order against a concurrent bulk purchase
    // walking the same rows in one sorted pass and deadlocks (HON-632).
    //
    // Interleaved per row, the combined sequence stays sorted. Two passes
    // would read `Zucchini, apple, Zucchini, apple` here instead.
    const response = await completeWithComponents([
      { ingredientId: 'ing-apple', quantityPerServing: 100 },
      { ingredientId: 'ing-Zucchini', quantityPerServing: 50 },
    ])

    expect(response.status).toBe(200)

    const lockOrder = [
      ...mockPantryUpdateMany.mock.calls.map(([args], index) => ({
        order: mockPantryUpdateMany.mock.invocationCallOrder[index] ?? 0,
        ingredientId: args.where?.ingredientId,
      })),
      ...mockPantryDeleteMany.mock.calls.map(([args], index) => ({
        order: mockPantryDeleteMany.mock.invocationCallOrder[index] ?? 0,
        ingredientId: args?.where?.ingredientId,
      })),
    ]
      .sort((a, b) => a.order - b.order)
      .map((entry) => entry.ingredientId)

    expect(lockOrder).toEqual(['ing-Zucchini', 'ing-Zucchini', 'ing-apple', 'ing-apple'])
  })

  it('sweeps an ingredient a meal lists twice with a single cleanup statement', async () => {
    // Two components of the same ingredient are two decrements — each
    // component consumes its own amount — but the row only needs deleting
    // once, and re-issuing the statement would be pure waste.
    const response = await completeWithComponents([
      { ingredientId: 'ing-1', quantityPerServing: 100 },
      { ingredientId: 'ing-1', quantityPerServing: 50 },
    ])

    expect(response.status).toBe(200)
    expect(mockPantryUpdateMany).toHaveBeenCalledTimes(2)
    expect(mockPantryDeleteMany).toHaveBeenCalledTimes(1)
    expect(mockPantryDeleteMany.mock.calls.map(([args]) => args?.where?.ingredientId)).toEqual([
      'ing-1',
    ])
  })

  it('sweeps each row right after its own decrement, inside one transaction', async () => {
    // The transaction body awaits in sequence, so a sweep that ran before its
    // row's decrement would judge depletion against the pre-deduction quantity
    // and leave emptied rows in the pantry.
    //
    // It is each row's *own* decrement that has to come first, not every
    // decrement in the transaction. Draining the decrements first and only
    // then sweeping would sort each pass but not their concatenation: a
    // `quantity: null` row takes no lock in the decrement pass, so it would be
    // locked after every quantified row, inverting the order against a
    // concurrent purchase walking the same rows in one sorted pass (HON-632).
    const response = await completeWithComponents([
      { ingredientId: 'ing-1', quantityPerServing: 100 },
      { ingredientId: 'ing-2', quantityPerServing: 50 },
    ])

    expect(response.status).toBe(200)
    const pantryOps = [
      ...mockClaimEntry.mock.invocationCallOrder.map((order) => ({ order, op: 'claim' })),
      ...mockPantryUpdateMany.mock.invocationCallOrder.map((order) => ({ order, op: 'decrement' })),
      ...mockPantryDeleteMany.mock.invocationCallOrder.map((order) => ({ order, op: 'cleanup' })),
    ].sort((a, b) => a.order - b.order)

    expect(pantryOps.map((entry) => entry.op)).toEqual([
      'claim',
      'decrement',
      'cleanup',
      'decrement',
      'cleanup',
    ])
    // All of it inside one transaction. Asserted by membership, not by call
    // count: `tx` and `prisma` are the same spy here, so a count-based check
    // passes whether or not a write actually ran inside the callback.
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledTimes(1)
    expect(writesOutsideTransaction).toEqual([])
  })
})

describe('PATCH /api/meal-plans/[id]/entries/[entryId] - servings on a completed entry', () => {
  // `servingOverride` is how many servings the pantry was charged at, so a
  // completed entry's count is frozen the same way its `mealId` is (HON-633):
  // changing it afterwards leaves the entry and the pantry disagreeing, and
  // nothing re-charges a completed entry (HON-652).
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
  })

  const entryWith = (status: string, servingOverride: number | null) =>
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      status,
      servingOverride,
      pantryDeductedAt: status === 'completed' ? new Date('2026-09-01') : null,
      plan: { household: { members: [{ id: 'member-1' }, { id: 'member-2' }] } },
      meal: { components: [{ ingredientId: 'ing-1', quantityPerServing: 100 }] },
    } as never)

  it('rejects a servingOverride change on a completed entry and writes nothing', async () => {
    entryWith('completed', 4)

    const response = await PATCH(createPatchRequest({ servingOverride: 6 }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Cannot change servings on a completed meal')
    expect(mockUpdateEntry).not.toHaveBeenCalled()
    expect(mockClaimEntry).not.toHaveBeenCalled()
    expect(mockFallbackWrite).not.toHaveBeenCalled()
  })

  it('rejects resetting a completed entry to the household default', async () => {
    // `null` is a change too: it reprices the meal at the household size.
    entryWith('completed', 4)

    const response = await PATCH(createPatchRequest({ servingOverride: null }), {
      params: createParams(),
    })

    expect(response.status).toBe(409)
    expect(mockClaimEntry).not.toHaveBeenCalled()
  })

  it('rejects re-completing an already-completed entry with a different count', async () => {
    // Not the "complete for N servings" path: the entry is already completed,
    // so the deduction guard charges nothing and the new count would stand
    // alone.
    entryWith('completed', 4)

    const response = await PATCH(
      createPatchRequest({ status: 'completed', deductPantry: true, servingOverride: 6 }),
      { params: createParams() },
    )
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Cannot change servings on a completed meal')
    expect(mockClaimEntry).not.toHaveBeenCalled()
    expect(mockPantryUpdateMany).not.toHaveBeenCalled()
  })

  it('lets a completed entry resend its stored count', async () => {
    // A no-op write — a retry or a double submit — disagrees with nothing.
    entryWith('completed', 4)
    mockClaimEntry.mockResolvedValue([
      { id: 'entry-123', status: 'completed', mealId: 'meal-123', rating: null },
    ] as never)

    const response = await PATCH(createPatchRequest({ servingOverride: 4 }), {
      params: createParams(),
    })

    expect(response.status).toBe(200)
  })

  it('still lets a completed entry change its note and rating', async () => {
    entryWith('completed', 4)
    mockUpdateEntry.mockResolvedValue({
      id: 'entry-123',
      status: 'completed',
      mealId: 'meal-123',
      rating: 'up',
    } as never)

    const response = await PATCH(createPatchRequest({ note: 'Great', rating: 'up' }), {
      params: createParams(),
    })

    expect(response.status).toBe(200)
    expect(mockUpdateEntry).toHaveBeenCalled()
  })

  it.each(['planned', 'skipped'])('changes servingOverride on a %s entry', async (status) => {
    entryWith(status, null)
    mockClaimEntry.mockResolvedValue([
      { id: 'entry-123', status, mealId: 'meal-123', rating: null },
    ] as never)

    const response = await PATCH(createPatchRequest({ servingOverride: 6 }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.status).toBe(status)
    expect(mockClaimEntry).toHaveBeenCalledWith({
      where: {
        id: 'entry-123',
        OR: [{ status: { not: 'completed' } }, { servingOverride: 6 }],
      },
      // Tips are cached per entry and priced at the old count, so the change
      // drops them too (HON-681).
      data: { servingOverride: 6, preparationTips: null },
    })
  })

  // The prep-tips prompt scales by the entry's effective servings (HON-614),
  // and the result is cached on the entry — so a count that moves afterwards
  // leaves pan sizes and timings for a meal nobody is cooking (HON-681).
  it('clears cached preparation tips when the serving count changes', async () => {
    entryWith('planned', 2)
    swapReturns({ id: 'entry-123', status: 'planned', mealId: 'meal-123', rating: null })

    const response = await PATCH(createPatchRequest({ servingOverride: 4 }), {
      params: createParams(),
    })

    expect(response.status).toBe(200)
    expect(mockClaimEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { servingOverride: 4, preparationTips: null },
      }),
    )
  })

  it('clears cached preparation tips when the override resets to the household default', async () => {
    // `null` reprices the meal at the household size, so tips generated for an
    // override of 6 are as wrong as any other stale count.
    entryWith('planned', 6)
    swapReturns({ id: 'entry-123', status: 'planned', mealId: 'meal-123', rating: null })

    const response = await PATCH(createPatchRequest({ servingOverride: null }), {
      params: createParams(),
    })

    expect(response.status).toBe(200)
    expect(mockClaimEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { servingOverride: null, preparationTips: null },
      }),
    )
  })

  it('keeps cached preparation tips when the PATCH resends the stored count', async () => {
    // A no-op write — a retry or a double submit — changes no input to the
    // tips, so throwing them away would cost a regeneration for nothing.
    entryWith('planned', 4)
    swapReturns({ id: 'entry-123', status: 'planned', mealId: 'meal-123', rating: null })

    const response = await PATCH(createPatchRequest({ servingOverride: 4 }), {
      params: createParams(),
    })

    expect(response.status).toBe(200)
    expect(mockClaimEntry).toHaveBeenCalledWith(
      expect.objectContaining({ data: { servingOverride: 4 } }),
    )
  })

  // `invalidateFutureEntryTips` carries `status: { not: 'completed' }`, so a
  // membership change deliberately leaves a completed entry's tips alone —
  // nulling a dinner already eaten would only buy a paid regeneration. That
  // trade holds only while the entry stays completed, so leaving `completed`
  // has to drop them, or the entry comes back priced at a member count the
  // household no longer has with nothing left to clear it (HON-684).
  it.each(['planned', 'skipped'])(
    'clears cached preparation tips when a completed entry reverts to %s',
    async (status) => {
      entryWith('completed', null)
      mockUpdateEntry.mockResolvedValue({
        id: 'entry-123',
        status,
        mealId: 'meal-123',
        rating: null,
      } as never)

      const response = await PATCH(createPatchRequest({ status }), {
        params: createParams(),
      })

      expect(response.status).toBe(200)
      expect(mockUpdateEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status, preparationTips: null },
        }),
      )
    },
  )

  it('keeps cached preparation tips when a completed entry is re-completed', async () => {
    // Resending the stored status changes no input to the tips, and the entry
    // never becomes cookable again, so throwing them away costs a regeneration
    // for nothing.
    entryWith('completed', null)
    mockUpdateEntry.mockResolvedValue({
      id: 'entry-123',
      status: 'completed',
      mealId: 'meal-123',
      rating: null,
    } as never)

    const response = await PATCH(createPatchRequest({ status: 'completed' }), {
      params: createParams(),
    })

    expect(response.status).toBe(200)
    expect(mockUpdateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'completed' } }),
    )
  })

  it('keeps cached preparation tips when a planned entry is skipped', async () => {
    // The membership invalidation already reaches a skipped entry
    // (`not: 'completed'`), so there is nothing to defer to this transition.
    entryWith('planned', null)
    mockUpdateEntry.mockResolvedValue({
      id: 'entry-123',
      status: 'skipped',
      mealId: 'meal-123',
      rating: null,
    } as never)

    const response = await PATCH(createPatchRequest({ status: 'skipped' }), {
      params: createParams(),
    })

    expect(response.status).toBe(200)
    expect(mockUpdateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'skipped' } }),
    )
  })

  it('keeps cached preparation tips on a note-only PATCH', async () => {
    entryWith('planned', 4)
    mockUpdateEntry.mockResolvedValue({
      id: 'entry-123',
      status: 'planned',
      mealId: 'meal-123',
      rating: null,
    } as never)

    const response = await PATCH(createPatchRequest({ note: 'Double the garlic' }), {
      params: createParams(),
    })

    expect(response.status).toBe(200)
    expect(mockUpdateEntry).toHaveBeenCalledWith({
      where: { id: 'entry-123' },
      data: { note: 'Double the garlic' },
    })
  })

  it('rejects a servings change that raced a concurrent completion', async () => {
    // Read as `planned`, so the serial guard passes — but a completion
    // committed before the write, charging the pantry at the old count. The
    // conditional write matches nothing, and that is the 409.
    entryWith('planned', null)
    mockClaimEntry.mockResolvedValue([] as never)

    const response = await PATCH(createPatchRequest({ servingOverride: 6 }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Cannot change servings on a completed meal')
    expect(mockUpdateEntry).not.toHaveBeenCalled()
  })

  it('still completes for N servings in one request, pricing the deduction at N', async () => {
    entryWith('planned', 2)
    mockDeductionTransaction()

    const response = await PATCH(
      createPatchRequest({ status: 'completed', deductPantry: true, servingOverride: 6 }),
      { params: createParams() },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.pantryDeducted).toBe(true)
    expect(mockPantryUpdateMany).toHaveBeenCalledWith(decrementOf('ing-1', 600))
  })

  it('rolls a completion back when a servings change committed before the claim', async () => {
    // The opposite order: `{ servingOverride: 6 }` commits between this
    // request's read (null → household of 2) and its claim. Charging the
    // 200g priced at the stale count would complete the entry at 6 while the
    // pantry paid for 2, with the count frozen from then on.
    entryWith('planned', null)
    mockDeductionTransaction(1, 'meal-123', 6)

    const response = await PATCH(createPatchRequest({ status: 'completed', deductPantry: true }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('The meal changed while completing. Try again.')
    expect(mockPantryUpdateMany).not.toHaveBeenCalled()
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('exempts a completion that sends its own count from the servings staleness check', async () => {
    // The request prices what it persists, so the stored count it overwrites
    // does not matter.
    entryWith('planned', null)
    mockDeductionTransaction(1, 'meal-123', 6)

    const response = await PATCH(
      createPatchRequest({ status: 'completed', deductPantry: true, servingOverride: 3 }),
      { params: createParams() },
    )

    expect(response.status).toBe(200)
    expect(mockPantryUpdateMany).toHaveBeenCalledWith(decrementOf('ing-1', 300))
  })

  it('refuses a servings change that lost the completion race, and charges nothing', async () => {
    // Two "complete for N" requests at once: the winner charged the pantry at
    // its count, so the loser must not overwrite the count with its own.
    // Throwing rolls the transaction back and answers 409 rather than 500.
    entryWith('planned', null)
    mockDeductionTransaction(0)

    const response = await PATCH(
      createPatchRequest({ status: 'completed', deductPantry: true, servingOverride: 6 }),
      { params: createParams() },
    )
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Cannot change servings on a completed meal')
    expect(mockFallbackWrite).toHaveBeenCalledWith({
      where: {
        id: 'entry-123',
        OR: [{ status: { not: 'completed' } }, { servingOverride: 6 }],
      },
      data: expect.objectContaining({ servingOverride: 6 }),
    })
    expect(mockPantryUpdateMany).not.toHaveBeenCalled()
    expect(mockCaptureApiError).not.toHaveBeenCalled()
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

  // A rating is a verdict on the meal the entry points at, so it goes when the
  // meal does — otherwise complete → rate → revert → swap leaves the entry
  // holding a verdict on a dish it no longer names, which HON-340 will read as
  // a preference for the one it does (HON-703). The exact `data` shape is
  // asserted rather than `objectContaining`, so the two resets this one joins
  // cannot quietly go missing from the same write.
  it('clears the rating when the meal is swapped', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)

    vi.mocked(prisma.meal.findFirst).mockResolvedValue({ id: 'new-meal-456' } as never)
    swapReturns({ id: 'entry-123', status: 'planned', mealId: 'new-meal-456', rating: null })

    const response = await PATCH(createPatchRequest({ mealId: 'new-meal-456' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.rating).toBeNull()
    expect(mockSwapEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          mealId: 'new-meal-456',
          preparationTips: null,
          servingOverride: null,
          rating: null,
        },
      }),
    )
  })

  it('keeps the rating when the PATCH does not change the meal', async () => {
    // The other direction: only a swap discards a rating. A note-only write
    // must not carry a `rating` key at all, or every unrelated edit would
    // throw the household's verdict away.
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
      status: 'planned',
      mealId: 'meal-123',
      rating: 'up',
    } as never)

    const response = await PATCH(createPatchRequest({ note: 'Leftovers' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.rating).toBe('up')
    expect(mockUpdateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ data: { note: 'Leftovers' } }),
    )
  })

  it('lets an explicit rating in the same request win over the swap reset', async () => {
    // The swap reset is written before the `'rating' in parsed.data` handler,
    // so a caller that swaps and rates in one request gets the rating it sent
    // — the same precedence `servingOverride` already has. Pinned so a reorder
    // of the two blocks fails here rather than silently discarding the value.
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)

    vi.mocked(prisma.meal.findFirst).mockResolvedValue({ id: 'new-meal-456' } as never)
    swapReturns({ id: 'entry-123', status: 'planned', mealId: 'new-meal-456', rating: 'up' })

    const response = await PATCH(createPatchRequest({ mealId: 'new-meal-456', rating: 'up' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.rating).toBe('up')
    expect(mockSwapEntry).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rating: 'up' }) }),
    )
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
