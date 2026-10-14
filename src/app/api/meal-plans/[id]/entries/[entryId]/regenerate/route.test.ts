import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

// The entry read lives in `@/lib/meal-plans/slot-context` (tested against a
// database in `slot-context.db.test.ts`) and the ranking in
// `@/lib/meal-planning/slot-suggestions` (`slot-suggestions.test.ts`). This
// file mocks both at the seam and asserts what the route owns: the session,
// the household, the rate limit, the cost cap, and the status each answer
// maps to (HON-1206).

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

vi.mock('@/lib/meal-plans/slot-context', () => ({
  loadSlotEntry: vi.fn(),
}))

vi.mock('@/lib/meal-planning/slot-suggestions', () => ({
  suggestForSlot: vi.fn(),
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
import { loadSlotEntry } from '@/lib/meal-plans/slot-context'
import { suggestForSlot } from '@/lib/meal-planning/slot-suggestions'
import { checkRateLimit } from '@/lib/rate-limit'
import { AiCostCapExceededError, assertUnderCap } from '@/lib/ai/usage'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockLoadSlotEntry = vi.mocked(loadSlotEntry)
const mockSuggestForSlot = vi.mocked(suggestForSlot)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockAssertUnderCap = vi.mocked(assertUnderCap)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const household = {
  id: 'household-123',
  name: 'Test',
  timezone: 'Europe/Tallinn',
  locale: 'et',
  preferences: null,
}

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household,
} as never

const entry = {
  id: 'entry-123',
  planId: 'plan-123',
  date: new Date('2099-01-28T00:00:00.000Z'),
  mealType: 'dinner',
  mealId: 'meal-current',
  meal: { id: 'meal-current', timeMinutes: 30, primaryProteinType: 'poultry' },
} as const

const post = () =>
  POST(
    new Request('http://localhost/api/meal-plans/plan-123/entries/entry-123/regenerate', {
      method: 'POST',
    }),
    { params: Promise.resolve({ id: 'plan-123', entryId: 'entry-123' }) },
  )

async function answer(response: Response | Promise<Response>) {
  const res = await response
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(mockMembership)
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 59,
    limit: 60,
    resetAt: new Date('2026-02-01T12:00:00.000Z'),
  })
  mockAssertUnderCap.mockResolvedValue(undefined)
  mockLoadSlotEntry.mockResolvedValue(entry as never)
})

describe('POST /api/meal-plans/[id]/entries/[entryId]/regenerate', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(post())).toEqual({ status: 401, body: { error: 'Unauthorized' } })
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(post())).toEqual({ status: 404, body: { error: 'No household found' } })
  })

  it('returns 429 with Retry-After from the shared suggestions bucket, before any DB work', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      limit: 60,
      resetAt: new Date('2026-02-01T12:00:00.000Z'),
    })

    const response = await post()

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('120')
    expect(await response.json()).toEqual({
      error: 'Rate limit exceeded',
      message: 'Maximum 60 suggestion requests per hour',
      resetAt: '2026-02-01T12:00:00.000Z',
    })
    expect(mockCheckRateLimit).toHaveBeenCalledWith('household-123', 'meal-suggestions')
    expect(mockAssertUnderCap).not.toHaveBeenCalled()
    expect(mockLoadSlotEntry).not.toHaveBeenCalled()
  })

  it('answers the cost cap before any DB work', async () => {
    mockAssertUnderCap.mockRejectedValue(
      new AiCostCapExceededError(new Date('2099-02-01T00:00:00.000Z'), 'Europe/Tallinn'),
    )

    const { status, body } = await answer(post())

    expect(status).toBe(429)
    expect(body.error).toBe('AI usage cap exceeded')
    expect(mockLoadSlotEntry).not.toHaveBeenCalled()
  })

  it('returns 404 when the entry is not in this plan of this household', async () => {
    mockLoadSlotEntry.mockResolvedValue(null)

    expect(await answer(post())).toEqual({
      status: 404,
      body: { error: 'Entry not found or access denied' },
    })
    expect(mockLoadSlotEntry).toHaveBeenCalledWith('household-123', 'plan-123', 'entry-123')
    expect(mockSuggestForSlot).not.toHaveBeenCalled()
  })

  it('returns 404 when no meal passes the filters', async () => {
    mockSuggestForSlot.mockResolvedValue([])

    expect(await answer(post())).toEqual({
      status: 404,
      body: { error: 'No alternative meals available matching your preferences' },
    })
  })

  it("ranks the entry in swap mode and the household's locale", async () => {
    const alternatives = [{ id: 'meal-alt-1', name: 'Salmon Bowl' }]
    mockSuggestForSlot.mockResolvedValue(alternatives as never)

    expect(await answer(post())).toEqual({ status: 200, body: { alternatives } })
    expect(mockSuggestForSlot).toHaveBeenCalledWith(household, entry, 'swap', 'et')
  })

  it('reports an unexpected failure and returns 500', async () => {
    const failure = new Error('connection lost')
    mockSuggestForSlot.mockRejectedValue(failure)

    expect(await answer(post())).toEqual({
      status: 500,
      body: { error: 'Failed to generate alternatives' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/meal-plans/[id]/entries/[entryId]/regenerate',
      userId: 'user-123',
      feature: 'meal_regenerate',
    })
  })
})
