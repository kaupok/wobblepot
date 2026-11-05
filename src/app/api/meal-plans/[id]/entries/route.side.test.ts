import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from './route'

// "Add side" and Undo after a side's Remove post `side: true` (HON-1611).
// `createSide` is tested against a database in `side-dishes.writes.db.test.ts`;
// this file asserts the body check and the answer each refusal maps to.

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/meal-plans/create-entry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/create-entry')>()),
  createEntry: vi.fn(),
}))

vi.mock('@/lib/meal-plans/create-side', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/create-side')>()),
  createSide: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { createEntry } from '@/lib/meal-plans/create-entry'
import { createSide, SideCreateError } from '@/lib/meal-plans/create-side'

const mockCreateSide = vi.mocked(createSide)

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/meal-plans/plan-123/entries', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'plan-123' }) },
  )

async function answer(response: Promise<Response>) {
  const res = await response
  return { status: res.status, body: await res.json() }
}

const slot = { date: '2099-01-27', mealType: 'dinner' } as const

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: 'user-123' } } as never)
  vi.mocked(getHouseholdMembership).mockResolvedValue({
    household: { id: 'household-123', timezone: 'Europe/Tallinn' },
  } as never)
})

describe('POST /api/meal-plans/[id]/entries with side: true', () => {
  it('adds the side to the slot and returns its status', async () => {
    mockCreateSide.mockResolvedValue({
      id: 'side-1',
      mainEntryId: 'main-1',
      status: 'planned',
      servings: 3,
    })

    expect(await answer(post({ ...slot, mealId: 'salad', side: true }))).toEqual({
      status: 200,
      body: { id: 'side-1', mainEntryId: 'main-1', status: 'planned', servings: 3 },
    })
    expect(mockCreateSide).toHaveBeenCalledWith('household-123', 'plan-123', {
      date: new Date(2099, 0, 27),
      mealType: 'dinner',
      mealId: 'salad',
      servingOverride: undefined,
      rating: undefined,
      skipped: false,
    })
    expect(createEntry).not.toHaveBeenCalled()
  })

  it('passes the servings and rating an Undo brings back', async () => {
    mockCreateSide.mockResolvedValue({
      id: 'side-2',
      mainEntryId: 'main-1',
      status: 'planned',
      servings: 2,
    })

    await post({ ...slot, mealId: 'salad', side: true, servingOverride: 2, rating: 'up' })

    expect(mockCreateSide).toHaveBeenCalledWith(
      'household-123',
      'plan-123',
      expect.objectContaining({ servingOverride: 2, rating: 'up', skipped: false }),
    )
  })

  it('brings a side that was not made back skipped', async () => {
    mockCreateSide.mockResolvedValue({
      id: 'side-3',
      mainEntryId: 'main-1',
      status: 'skipped',
      servings: 3,
    })

    await post({ ...slot, mealId: 'salad', side: true, status: 'skipped' })

    expect(mockCreateSide).toHaveBeenCalledWith(
      'household-123',
      'plan-123',
      expect.objectContaining({ skipped: true }),
    )
  })

  it.each([
    ['alreadyInSlot', 409],
    ['noMain', 409],
    ['mainSkipped', 409],
    ['mealNotFound', 404],
  ] as const)('answers %s with %i and its code', async (reason, status) => {
    mockCreateSide.mockRejectedValue(new SideCreateError(reason))

    const res = await answer(post({ ...slot, mealId: 'salad', side: true }))

    expect(res.status).toBe(status)
    expect(res.body.code).toBe(reason)
  })

  it.each([
    ['no mealId', {}],
    ['a status', { mealId: 'salad', status: 'completed' }],
    ['a note', { mealId: 'salad', note: 'Hi' }],
    ['pick', { pick: 'suggested' }],
  ])('refuses a side with %s', async (_label, extra) => {
    const res = await answer(post({ ...slot, side: true, ...extra }))

    expect(res.status).toBe(400)
    expect(mockCreateSide).not.toHaveBeenCalled()
  })
})
