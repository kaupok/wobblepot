import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

vi.mock('@/lib/meal-plans/create-entry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/create-entry')>()),
  createEntry: vi.fn(),
}))

vi.mock('@/lib/meal-plans/entries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/entries')>()),
  deleteEntriesInRange: vi.fn(),
}))

vi.mock('@/lib/meal-plans/pick-for-slot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/pick-for-slot')>()),
  pickMealForSlot: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  retryAfterSeconds: vi.fn(() => 120),
}))

vi.mock('@/lib/ai/usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/usage')>()),
  assertUnderCap: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import {
  createEntry,
  EntryCreateError,
  type EntryCreateRefusal,
} from '@/lib/meal-plans/create-entry'
import { deleteEntriesInRange } from '@/lib/meal-plans/entries'
import { FridgeItemNotFoundError } from '@/lib/meal-plans/fridge-meal'
import { NoSuggestionsError, pickMealForSlot } from '@/lib/meal-plans/pick-for-slot'
import { checkRateLimit } from '@/lib/rate-limit'
import { AiCostCapExceededError, assertUnderCap } from '@/lib/ai/usage'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockCreateEntry = vi.mocked(createEntry)
const mockDeleteEntriesInRange = vi.mocked(deleteEntriesInRange)
const mockPickMealForSlot = vi.mocked(pickMealForSlot)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockAssertUnderCap = vi.mocked(assertUnderCap)

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
      ['a completed entry on a day still to come', { status: 'completed' }],
      ['a note position without a note', { note: null }],
      ['half a note position', { noteY: null }],
    ])('refuses %s', async (_label, override) => {
      const { status } = await answer(post({ ...restoreBody, ...override }))

      expect(status).toBe(400)
      expect(mockCreateEntry).not.toHaveBeenCalled()
    })
  })

  describe('logging a past meal (HON-1383)', () => {
    // 10:00 in Tallinn on 10 March 2026, so the household's today is the 10th.
    const NOW = new Date('2026-03-10T08:00:00.000Z')

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(NOW)
      mockCreateEntry.mockResolvedValue({ ...created, status: 'completed' })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('creates a completed recipe meal on a day before today', async () => {
      const { status } = await answer(
        post({ date: '2026-03-09', mealType: 'dinner', mealId: 'meal-1', status: 'completed' }),
      )

      expect(status).toBe(200)
      expect(mockCreateEntry).toHaveBeenCalledWith('household-123', 'plan-123', {
        date: new Date(2026, 2, 9),
        mealType: 'dinner',
        mealId: 'meal-1',
        status: 'completed',
      })
    })

    it('creates a completed fridge meal on a day before today', async () => {
      const fridgeItems = [{ label: 'Wolt' }]
      const { status } = await answer(
        post({ date: '2026-03-08', mealType: 'dinner', fridgeItems, status: 'completed' }),
      )

      expect(status).toBe(200)
      expect(mockCreateEntry).toHaveBeenCalledWith('household-123', 'plan-123', {
        date: new Date(2026, 2, 8),
        mealType: 'dinner',
        fridgeItems,
        status: 'completed',
      })
    })

    it.each([
      ['today', '2026-03-10'],
      ['tomorrow', '2026-03-11'],
    ])('refuses a completed entry for %s', async (_label, date) => {
      const { status } = await answer(
        post({ date, mealType: 'dinner', mealId: 'meal-1', status: 'completed' }),
      )

      expect(status).toBe(400)
      expect(mockCreateEntry).not.toHaveBeenCalled()
    })

    it.each([
      ['pick', { pick: 'suggested', mealId: undefined }],
      ['pantryDeducted', { pantryDeducted: true }],
    ])('refuses a completed entry with %s', async (_label, override) => {
      const { status } = await answer(
        post({
          date: '2026-03-09',
          mealType: 'dinner',
          mealId: 'meal-1',
          status: 'completed',
          ...override,
        }),
      )

      expect(status).toBe(400)
      expect(mockCreateEntry).not.toHaveBeenCalled()
    })
  })

  describe('Pick for me (HON-1248)', () => {
    const pickBody = { date: '2099-01-28', mealType: 'dinner', pick: 'suggested' }
    const resetAt = new Date('2099-01-28T18:40:00.000Z')

    beforeEach(() => {
      mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 59, limit: 60, resetAt })
      mockAssertUnderCap.mockResolvedValue(undefined)
      mockPickMealForSlot.mockResolvedValue({ ...created, mealName: 'Fish pie' })
    })

    it("places the slot's top suggestion in the household's locale and returns it named", async () => {
      mockGetMembership.mockResolvedValue({
        ...(mockMembership as object),
        household: {
          id: 'household-123',
          name: 'Test',
          timezone: 'Europe/Tallinn',
          locale: 'et',
        },
      } as never)

      expect(await answer(post(pickBody))).toEqual({
        status: 200,
        body: { ...created, mealName: 'Fish pie' },
      })
      expect(mockPickMealForSlot).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'household-123' }),
        'plan-123',
        { date: '2099-01-28', mealType: 'dinner' },
        'et',
      )
      expect(mockCreateEntry).not.toHaveBeenCalled()
    })

    it('answers 404 with code no_suggestions when no meal fits, unreported', async () => {
      mockPickMealForSlot.mockRejectedValue(new NoSuggestionsError())

      expect(await answer(post(pickBody))).toEqual({
        status: 404,
        body: { error: 'No meals available matching your preferences', code: 'no_suggestions' },
      })
      expect(mockCaptureApiError).not.toHaveBeenCalled()
    })

    it('answers a taken slot with 409', async () => {
      mockPickMealForSlot.mockRejectedValue(new EntryCreateError('slotTaken'))

      expect(await answer(post(pickBody))).toEqual({
        status: 409,
        body: { error: 'Entry already exists for this date and meal type' },
      })
    })

    it('refuses pick together with mealId', async () => {
      const { status, body } = await answer(post({ ...pickBody, mealId: 'meal-1' }))

      expect(status).toBe(400)
      expect(body.details).toEqual({ pick: ['pick and mealId exclude each other'] })
      expect(mockCheckRateLimit).not.toHaveBeenCalled()
      expect(mockPickMealForSlot).not.toHaveBeenCalled()
    })

    it('applies the meal-suggestions rate limit before the cap check', async () => {
      mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, limit: 60, resetAt })

      const res = await post(pickBody)

      expect(res.status).toBe(429)
      expect(res.headers.get('Retry-After')).toBe('120')
      expect(await res.json()).toEqual({
        error: 'Rate limit exceeded',
        message: 'Maximum 60 suggestion requests per hour',
        resetAt: '2099-01-28T18:40:00.000Z',
      })
      expect(mockCheckRateLimit).toHaveBeenCalledWith('household-123', 'meal-suggestions')
      expect(mockAssertUnderCap).not.toHaveBeenCalled()
      expect(mockPickMealForSlot).not.toHaveBeenCalled()
    })

    it('answers the AI cap with its code and writes nothing', async () => {
      mockAssertUnderCap.mockRejectedValue(
        new AiCostCapExceededError(new Date('2099-02-01T00:00:00.000Z'), 'Europe/Tallinn'),
      )

      const { status, body } = await answer(post(pickBody))

      expect(status).toBe(429)
      expect(body.code).toBe('ai_cap_exceeded')
      expect(mockAssertUnderCap).toHaveBeenCalledWith('household-123')
      expect(mockPickMealForSlot).not.toHaveBeenCalled()
    })

    it('does not throttle a plain create', async () => {
      mockCreateEntry.mockResolvedValue(created)

      await post({ date: '2099-01-28', mealType: 'dinner' })

      expect(mockCheckRateLimit).not.toHaveBeenCalled()
      expect(mockAssertUnderCap).not.toHaveBeenCalled()
    })
  })

  describe('fridge meal (HON-1277)', () => {
    const fridgeItems = [{ ingredientId: 'ing-cucumber' }, { label: 'store meatballs' }]

    it('passes the items through to createEntry', async () => {
      mockCreateEntry.mockResolvedValue({ ...created, mealId: null })

      const { status } = await answer(post({ date: '2099-01-28', mealType: 'dinner', fridgeItems }))

      expect(status).toBe(200)
      expect(mockCreateEntry).toHaveBeenCalledWith('household-123', 'plan-123', {
        date: new Date(2099, 0, 28),
        mealType: 'dinner',
        fridgeItems,
      })
    })

    it.each([
      ['with a meal', { mealId: 'meal-1' }],
      ['with a pick', { pick: 'suggested' }],
    ])('refuses items %s', async (_label, extra) => {
      const body = { date: '2099-01-28', mealType: 'dinner', fridgeItems, ...extra }

      expect((await answer(post(body))).status).toBe(400)
      expect(mockCreateEntry).not.toHaveBeenCalled()
    })

    it('answers 404 for an item the household may not see, unreported', async () => {
      mockCreateEntry.mockRejectedValue(new FridgeItemNotFoundError())

      expect(await answer(post({ date: '2099-01-28', mealType: 'dinner', fridgeItems }))).toEqual({
        status: 404,
        body: { error: 'Fridge meal item not found' },
      })
      expect(mockCaptureApiError).not.toHaveBeenCalled()
    })
  })
})
