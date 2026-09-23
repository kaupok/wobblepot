import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

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

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  retryAfterSeconds: vi.fn(() => 60),
}))

vi.mock('@/lib/ai/generate-plan', () => ({
  generateMealPlan: vi.fn(),
  createEmptyPlan: vi.fn(),
}))

vi.mock('@/lib/ai/fill-plan', () => ({
  fillEmptySlots: vi.fn(),
}))

vi.mock('@/lib/meal-planning/dates', () => ({
  parseLocalDate: vi.fn((s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number]
    return new Date(y, m - 1, d)
  }),
}))

vi.mock('@/lib/feature-flags', () => ({
  getServerFlag: vi.fn(),
}))

vi.mock('@/lib/ai/usage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/usage')>()
  return {
    ...actual,
    assertUnderCap: vi.fn(),
    recordAiUsage: vi.fn(),
  }
})

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { checkRateLimit } from '@/lib/rate-limit'
import { generateMealPlan, createEmptyPlan } from '@/lib/ai/generate-plan'
import { fillEmptySlots } from '@/lib/ai/fill-plan'
import {
  MealPlanValidationError,
  InsufficientCandidatesError,
  NoEmptySlotsError,
} from '@/lib/ai/types'
import { AiCostCapExceededError, assertUnderCap } from '@/lib/ai/usage'
import { getServerFlag } from '@/lib/feature-flags'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockGenerateMealPlan = vi.mocked(generateMealPlan)
const mockCreateEmptyPlan = vi.mocked(createEmptyPlan)
const mockFillEmptySlots = vi.mocked(fillEmptySlots)
const mockAssertUnderCap = vi.mocked(assertUnderCap)
const mockGetServerFlag = vi.mocked(getServerFlag)

const mockHousehold = {
  id: 'household-123',
  name: 'Test Household',
  timezone: 'Europe/Tallinn',
  preferences: {
    dietaryType: null,
    allergensToAvoid: [],
    excludedIngredientIds: [],
    restrictions: [],
    weekdayMealTypes: ['dinner'],
    weekendMealTypes: ['dinner'],
  },
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

function createRequest(body?: unknown) {
  return new Request('http://localhost/api/meal-plans/generate', {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

describe('POST /api/meal-plans/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 4,
      limit: 5,
      resetAt: new Date('2026-02-01T12:00:00.000Z'),
    })
    mockAssertUnderCap.mockResolvedValue(undefined)
    mockGetServerFlag.mockResolvedValue(true)
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(createRequest())
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
    expect(data.code).toBe('unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const response = await POST(createRequest())
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
    expect(data.code).toBe('no_household')
  })

  it('returns 429 with Retry-After header when rate limited', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      limit: 5,
      resetAt: new Date('2026-02-01T12:00:00.000Z'),
    })

    const response = await POST(createRequest())
    const data = await response.json()

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(data.error).toBe('Rate limit exceeded')
    expect(data.code).toBe('rate_limited')
    expect(data.resetAt).toBe('2026-02-01T12:00:00.000Z')
  })

  it('returns 400 for invalid JSON body', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const request = new Request('http://localhost/api/meal-plans/generate', {
      method: 'POST',
      body: 'not valid json',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
    expect(data.code).toBe('invalid_request')
  })

  it('returns 400 for missing startDate or endDate', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await POST(createRequest({ startDate: '2026-02-02' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.code).toBe('invalid_request')
    expect(data.details.endDate).toBeDefined()
  })

  it('returns 400 when endDate is not after startDate', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await POST(createRequest({ startDate: '2026-02-09', endDate: '2026-02-02' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('endDate must be after startDate')
    expect(data.code).toBe('invalid_request')
  })

  it('returns 400 when date range exceeds 14 days', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await POST(createRequest({ startDate: '2026-02-02', endDate: '2026-02-17' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Date range cannot exceed 14 days')
    expect(data.code).toBe('invalid_request')
  })

  it('returns 200 with generated plan for valid date range', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const mockResult = {
      id: 'plan-123',
      startDate: '2026-02-02',
      endDate: '2026-02-09',
      entries: [
        { id: 'entry-1', date: '2026-02-02', mealType: 'dinner', status: 'planned' },
        { id: 'entry-2', date: '2026-02-03', mealType: 'dinner', status: 'planned' },
      ],
    }
    mockGenerateMealPlan.mockResolvedValue(mockResult as never)

    const response = await POST(createRequest({ startDate: '2026-02-02', endDate: '2026-02-09' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.id).toBe('plan-123')
    expect(mockGenerateMealPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: 'household-123',
        startDate: expect.any(Date),
        endDate: expect.any(Date),
        // HON-694: without a budget the AI call is unbounded and the platform,
        // not the 504 below, decides when a slow generation ends.
        aiBudgetMs: expect.any(Number),
      }),
    )
    expect(mockCheckRateLimit).toHaveBeenCalledWith('household-123', 'plan-generation')
  })

  it('returns 200 for empty mode', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const mockResult = { id: 'plan-empty', startDate: '2026-02-02', endDate: '2026-02-09' }
    mockCreateEmptyPlan.mockResolvedValue(mockResult as never)

    const response = await POST(
      createRequest({ startDate: '2026-02-02', endDate: '2026-02-09', mode: 'empty' }),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.id).toBe('plan-empty')
    expect(mockCreateEmptyPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: 'household-123',
        startDate: expect.any(Date),
        endDate: expect.any(Date),
      }),
    )
    expect(mockCheckRateLimit).toHaveBeenCalledWith('household-123', 'plan-generation')
  })

  it('returns 400 for fill-empty mode without planId', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await POST(
      createRequest({ startDate: '2026-02-02', endDate: '2026-02-09', mode: 'fill-empty' }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('planId is required for fill-empty mode')
    expect(data.code).toBe('invalid_request')
  })

  it('returns 200 for fill-empty mode with planId and date range', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const mockResult = {
      id: 'plan-123',
      entries: [{ id: 'entry-new', date: '2026-02-04', mealType: 'dinner', status: 'planned' }],
    }
    mockFillEmptySlots.mockResolvedValue(mockResult as never)

    const response = await POST(
      createRequest({
        startDate: '2026-02-02',
        endDate: '2026-02-09',
        mode: 'fill-empty',
        planId: 'plan-123',
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.id).toBe('plan-123')
    expect(mockFillEmptySlots).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: 'plan-123',
        householdId: 'household-123',
        startDate: expect.any(Date),
        endDate: expect.any(Date),
        // HON-694: same budget applies on the fill-empty path.
        aiBudgetMs: expect.any(Number),
      }),
    )
    expect(mockCheckRateLimit).toHaveBeenCalledWith('household-123', 'plan-generation')
  })

  it('returns 422 when AI validation fails', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockGenerateMealPlan.mockRejectedValue(new MealPlanValidationError('Invalid AI response'))

    const response = await POST(createRequest({ startDate: '2026-02-02', endDate: '2026-02-09' }))
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.error).toBe('AI generated an invalid meal plan')
    expect(data.code).toBe('invalid_plan')
  })

  it('returns 422 when insufficient candidates', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockGenerateMealPlan.mockRejectedValue(new InsufficientCandidatesError('Not enough fish meals'))

    const response = await POST(createRequest({ startDate: '2026-02-02', endDate: '2026-02-09' }))
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.error).toBe('Insufficient meal options')
    expect(data.code).toBe('insufficient_candidates')
  })

  it('returns 500 for unexpected errors', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockGenerateMealPlan.mockRejectedValue(new Error('Something unexpected'))

    const response = await POST(createRequest({ startDate: '2026-02-02', endDate: '2026-02-09' }))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to generate meal plan')
    expect(data.code).toBe('generation_failed')
  })

  it('returns 504 when the generation exceeds its budget', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    const err = new Error('The operation was aborted due to timeout')
    err.name = 'TimeoutError'
    mockGenerateMealPlan.mockRejectedValue(err)

    const response = await POST(createRequest({ startDate: '2026-02-02', endDate: '2026-02-09' }))
    const data = await response.json()

    expect(response.status).toBe(504)
    expect(data.message).toContain('too long')
    expect(data.code).toBe('generation_timeout')
  })

  it('returns 504 when the budget fires during a retry sleep (AbortError)', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    // Not a hand-built TimeoutError: when the budget fires during ai@7's retry
    // sleep the SDK surfaces `AbortError` instead, and a check that only knows
    // the one name falls through to the generic 500 (HON-694, round 3).
    mockGenerateMealPlan.mockRejectedValue(new DOMException('Delay was aborted', 'AbortError'))

    const response = await POST(createRequest({ startDate: '2026-02-02', endDate: '2026-02-09' }))
    const data = await response.json()

    expect(response.status).toBe(504)
    expect(data.message).toContain('too long')
    expect(data.code).toBe('generation_timeout')
  })

  it('returns 504 when fill-empty exceeds its budget', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    const err = new Error('The operation was aborted due to timeout')
    err.name = 'TimeoutError'
    mockFillEmptySlots.mockRejectedValue(err)

    const response = await POST(
      createRequest({
        startDate: '2026-02-02',
        endDate: '2026-02-09',
        mode: 'fill-empty',
        planId: 'plan-123',
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(504)
    expect(data.message).toContain('too long')
    expect(data.code).toBe('generation_timeout')
  })
  // HON-725: every error branch carries a stable `code` for the clients to
  // translate. The branches above assert theirs inline; these had no test.
  describe('error codes', () => {
    const fillRequest = () =>
      createRequest({
        startDate: '2026-02-02',
        endDate: '2026-02-09',
        mode: 'fill-empty',
        planId: 'plan-123',
      })

    beforeEach(() => {
      mockGetSession.mockResolvedValue(mockSession as never)
      mockGetMembership.mockResolvedValue(mockMembership as never)
    })

    it('returns generation_disabled when the kill-switch is off', async () => {
      mockGetServerFlag.mockResolvedValue(false)

      const response = await POST(createRequest({ startDate: '2026-02-02', endDate: '2026-02-09' }))
      const data = await response.json()

      expect(response.status).toBe(503)
      expect(data.code).toBe('generation_disabled')
    })

    it('returns ai_cap_exceeded when the monthly cap is hit', async () => {
      mockAssertUnderCap.mockRejectedValue(
        new AiCostCapExceededError(new Date('2026-03-01T00:00:00Z'), 'Europe/Tallinn'),
      )

      const response = await POST(createRequest({ startDate: '2026-02-02', endDate: '2026-02-09' }))
      const data = await response.json()

      expect(response.status).toBe(429)
      expect(data.code).toBe('ai_cap_exceeded')
    })

    it('returns no_empty_slots when fill-empty has nothing to fill', async () => {
      mockFillEmptySlots.mockRejectedValue(new NoEmptySlotsError())

      const response = await POST(fillRequest())
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.code).toBe('no_empty_slots')
    })

    it('returns plan_not_found when fill-empty targets a missing plan', async () => {
      mockFillEmptySlots.mockRejectedValue(new Error('Plan not found'))

      const response = await POST(fillRequest())
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.code).toBe('plan_not_found')
    })

    it('returns invalid_plan when fill-empty validation fails', async () => {
      mockFillEmptySlots.mockRejectedValue(new MealPlanValidationError('Invalid AI response'))

      const response = await POST(fillRequest())
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.code).toBe('invalid_plan')
    })

    it('returns insufficient_candidates when fill-empty lacks options', async () => {
      mockFillEmptySlots.mockRejectedValue(new InsufficientCandidatesError('fish'))

      const response = await POST(fillRequest())
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.code).toBe('insufficient_candidates')
    })

    it('returns generation_failed for an unexpected fill-empty error', async () => {
      mockFillEmptySlots.mockRejectedValue(new Error('boom'))

      const response = await POST(fillRequest())
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.code).toBe('generation_failed')
    })

    it('returns generation_failed when empty mode fails', async () => {
      mockCreateEmptyPlan.mockRejectedValue(new Error('boom'))

      const response = await POST(
        createRequest({ startDate: '2026-02-02', endDate: '2026-02-09', mode: 'empty' }),
      )
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.code).toBe('generation_failed')
    })
  })
})
