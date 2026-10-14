import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST, DELETE } from './route'

// The plan, slot and meal checks and every query live in
// `@/lib/meal-plans/entries`, tested against a database in
// `entries.db.test.ts`. This file mocks that module at the seam and asserts
// what the route owns: the session, the household, body and query validation,
// and the status and body each answer maps to (HON-1206).

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

vi.mock('@/lib/meal-plans/entries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/entries')>()),
  createEntry: vi.fn(),
  deleteEntriesInRange: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import {
  createEntry,
  deleteEntriesInRange,
  EntryCreateError,
  type EntryCreateRefusal,
} from '@/lib/meal-plans/entries'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockCreateEntry = vi.mocked(createEntry)
const mockDeleteEntriesInRange = vi.mocked(deleteEntriesInRange)

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

const URL = 'http://localhost/api/meal-plans/plan-123/entries'
const params = () => Promise.resolve({ id: 'plan-123' })

const post = (body: unknown) =>
  POST(
    new Request(URL, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: params() },
  )

const del = (query = '?startDate=2026-01-12&endDate=2026-01-19') =>
  DELETE(new Request(`${URL}${query}`, { method: 'DELETE' }), { params: params() })

async function answer(response: Promise<Response>) {
  const res = await response
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(mockMembership)
})

describe('DELETE /api/meal-plans/[id]/entries', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(del())).toEqual({ status: 401, body: { error: 'Unauthorized' } })
    expect(mockDeleteEntriesInRange).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(del())).toEqual({ status: 404, body: { error: 'No household found' } })
    expect(mockDeleteEntriesInRange).not.toHaveBeenCalled()
  })

  it.each(['', '?startDate=2026-01-12', '?endDate=2026-01-19'])(
    'returns 400 without both date params (%s), before any delete',
    async (query) => {
      expect(await answer(del(query))).toEqual({
        status: 400,
        body: { error: 'startDate and endDate query params are required' },
      })
      expect(mockDeleteEntriesInRange).not.toHaveBeenCalled()
    },
  )

  it("returns 404 when the plan is not the household's", async () => {
    mockDeleteEntriesInRange.mockResolvedValue(null)

    expect(await answer(del())).toEqual({ status: 404, body: { error: 'Meal plan not found' } })
  })

  it('deletes the range in local days and returns the count', async () => {
    mockDeleteEntriesInRange.mockResolvedValue(5)

    expect(await answer(del())).toEqual({ status: 200, body: { success: true, deletedCount: 5 } })
    expect(mockDeleteEntriesInRange).toHaveBeenCalledWith(
      'household-123',
      'plan-123',
      new Date(2026, 0, 12),
      new Date(2026, 0, 19),
    )
  })

  it('reports an unexpected failure and returns 500', async () => {
    const failure = new Error('connection lost')
    mockDeleteEntriesInRange.mockRejectedValue(failure)

    expect(await answer(del())).toEqual({
      status: 500,
      body: { error: 'Failed to delete entries' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/meal-plans/[id]/entries',
      userId: 'user-123',
    })
  })
})

describe('POST /api/meal-plans/[id]/entries', () => {
  const created = {
    id: 'new-entry',
    date: '2099-01-28',
    mealType: 'dinner',
    status: 'planned',
    mealId: 'meal-1',
    note: null,
  } as const

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(post({ date: '2099-01-27', mealType: 'dinner' }))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    })
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(post({ date: '2099-01-27', mealType: 'dinner' }))).toEqual({
      status: 404,
      body: { error: 'No household found' },
    })
  })

  it('returns 400 for invalid JSON', async () => {
    expect(await answer(post('not json'))).toEqual({
      status: 400,
      body: { error: 'Invalid JSON' },
    })
  })

  it.each([
    ['an invalid date format', { date: 'not-a-date', mealType: 'dinner' }],
    ['an invalid meal type', { date: '2099-01-27', mealType: 'snack' }],
  ])('returns 400 for %s', async (_label, body) => {
    const { status, body: data } = await answer(post(body))

    expect(status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(mockCreateEntry).not.toHaveBeenCalled()
  })

  it('creates the entry on the local day and returns it', async () => {
    mockCreateEntry.mockResolvedValue(created)

    expect(
      await answer(post({ date: '2099-01-28', mealType: 'dinner', mealId: 'meal-1' })),
    ).toEqual({ status: 200, body: created })
    expect(mockCreateEntry).toHaveBeenCalledWith('household-123', 'plan-123', {
      date: new Date(2099, 0, 28),
      mealType: 'dinner',
      mealId: 'meal-1',
    })
  })

  it.each([
    ['planNotFound', 404, 'Plan not found or access denied'],
    ['slotTaken', 409, 'Entry already exists for this date and meal type'],
    ['mealNotFound', 404, 'Meal not found'],
  ] satisfies [EntryCreateRefusal, number, string][])(
    'answers %s with %i, unreported',
    async (reason, status, error) => {
      mockCreateEntry.mockRejectedValue(new EntryCreateError(reason))

      expect(await answer(post({ date: '2099-01-28', mealType: 'dinner' }))).toEqual({
        status,
        body: { error },
      })
      expect(mockCaptureApiError).not.toHaveBeenCalled()
    },
  )

  it('reports an unexpected failure and returns 500', async () => {
    const failure = new Error('connection lost')
    mockCreateEntry.mockRejectedValue(failure)

    expect(await answer(post({ date: '2099-01-28', mealType: 'dinner' }))).toEqual({
      status: 500,
      body: { error: 'Failed to create entry' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/meal-plans/[id]/entries',
      userId: 'user-123',
      householdId: 'household-123',
    })
  })

  describe('restore after Clear (HON-1123)', () => {
    const restoreBody = {
      date: '2099-01-28',
      mealType: 'dinner',
      mealId: 'meal-1',
      note: 'Leftovers for lunch',
      noteX: 0.25,
      noteY: 0.75,
      status: 'skipped',
      servingOverride: 6,
      rating: 'down',
    }

    beforeEach(() => {
      mockCreateEntry.mockResolvedValue({ ...created, id: 'restored-entry', status: 'skipped' })
    })

    it("passes the cleared entry's fields through", async () => {
      const { status } = await answer(post({ ...restoreBody, pantryDeducted: true }))

      expect(status).toBe(200)
      expect(mockCreateEntry).toHaveBeenCalledWith('household-123', 'plan-123', {
        date: new Date(2099, 0, 28),
        mealType: 'dinner',
        mealId: 'meal-1',
        note: 'Leftovers for lunch',
        noteX: 0.25,
        noteY: 0.75,
        status: 'skipped',
        servingOverride: 6,
        rating: 'down',
        pantryDeducted: true,
      })
    })

    it.each([
      ['a completed entry', { status: 'completed' }],
      ['a note position without a note', { note: null }],
      ['half a note position', { noteY: null }],
    ])('refuses %s', async (_label, override) => {
      const { status } = await answer(post({ ...restoreBody, ...override }))

      expect(status).toBe(400)
      expect(mockCreateEntry).not.toHaveBeenCalled()
    })
  })
})
