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

const pastEndDate = new Date('2025-01-06T00:00:00.000Z') // A Monday in the past
const futureEndDate = new Date('2099-01-06T00:00:00.000Z') // Far future

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

describe('PATCH /api/meal-plans/[id]/entries/[entryId] - past week guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
  })

  it('allows status change to completed on past-week entries', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        endDate: pastEndDate,
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

  it('allows status change to skipped on past-week entries', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        endDate: pastEndDate,
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

  it('blocks meal swap on past-week entries', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        endDate: pastEndDate,
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)

    const response = await PATCH(createPatchRequest({ mealId: 'new-meal-456' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Cannot modify past week plans')
  })

  it('blocks meal swap combined with status change on past-week entries', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        endDate: pastEndDate,
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)

    const response = await PATCH(
      createPatchRequest({ status: 'completed', mealId: 'new-meal-456' }),
      { params: createParams() },
    )
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Cannot modify past week plans')
  })

  it('allows all modifications on current-week entries', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        endDate: futureEndDate,
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

  it('allows pantry deduction when completing past-week entries', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        endDate: pastEndDate,
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
})

describe('PATCH /api/meal-plans/[id]/entries/[entryId] - rating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
  })

  it('allows rating update on current-week entries', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        endDate: futureEndDate,
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

  it('allows rating update on past-week entries', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        endDate: pastEndDate,
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)
    mockUpdateEntry.mockResolvedValue({
      id: 'entry-123',
      status: 'completed',
      mealId: 'meal-123',
      rating: 'down',
    } as never)

    const response = await PATCH(createPatchRequest({ rating: 'down' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.rating).toBe('down')
  })

  it('allows clearing rating with null', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        endDate: futureEndDate,
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
        endDate: futureEndDate,
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)

    const response = await PATCH(createPatchRequest({ rating: 'invalid' }), {
      params: createParams(),
    })

    expect(response.status).toBe(400)
  })

  it('blocks rating combined with note on past-week entries', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      mealId: 'meal-123',
      plan: {
        endDate: pastEndDate,
        household: { members: [{ id: 'member-1' }] },
      },
      meal: { components: [] },
    } as never)

    const response = await PATCH(createPatchRequest({ rating: 'up', note: 'sneaky edit' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Cannot modify past week plans')
  })
})

describe('DELETE /api/meal-plans/[id]/entries/[entryId] - past week guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
  })

  it('blocks deletion of past-week entries', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      plan: { endDate: pastEndDate },
    } as never)

    const response = await DELETE(createDeleteRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Cannot modify past week plans')
  })

  it('allows deletion of current-week entries', async () => {
    mockFindFirstEntry.mockResolvedValue({
      id: 'entry-123',
      plan: { endDate: futureEndDate },
    } as never)
    mockDeleteEntry.mockResolvedValue({ id: 'entry-123' } as never)

    const response = await DELETE(createDeleteRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })
})
