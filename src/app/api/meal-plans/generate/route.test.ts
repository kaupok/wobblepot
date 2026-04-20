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
  fillEmptySlots: vi.fn(),
}))

vi.mock('@/lib/meal-planning/dates', () => ({
  parseLocalDate: vi.fn((s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number]
    return new Date(y, m - 1, d)
  }),
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
import { generateMealPlan, createEmptyPlan, fillEmptySlots } from '@/lib/ai/generate-plan'
import {
  MealPlanValidationError,
  InsufficientCandidatesError,
  NoEmptySlotsError,
} from '@/lib/ai/types'
import { assertUnderCap } from '@/lib/ai/usage'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockGenerateMealPlan = vi.mocked(generateMealPlan)
const mockCreateEmptyPlan = vi.mocked(createEmptyPlan)
const mockFillEmptySlots = vi.mocked(fillEmptySlots)
const mockAssertUnderCap = vi.mocked(assertUnderCap)

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
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(createRequest())
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const response = await POST(createRequest())
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
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
  })

  it('returns 400 for missing startDate or endDate', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await POST(createRequest({ startDate: '2026-02-02' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.endDate).toBeDefined()
  })

  it('returns 400 when endDate is not after startDate', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await POST(createRequest({ startDate: '2026-02-09', endDate: '2026-02-02' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('endDate must be after startDate')
  })

  it('returns 400 when date range exceeds 14 days', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await POST(createRequest({ startDate: '2026-02-02', endDate: '2026-02-17' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Date range cannot exceed 14 days')
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
  })

  it('returns 422 when insufficient candidates', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockGenerateMealPlan.mockRejectedValue(new InsufficientCandidatesError('Not enough fish meals'))

    const response = await POST(createRequest({ startDate: '2026-02-02', endDate: '2026-02-09' }))
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.error).toBe('Insufficient meal options')
  })

  it('returns 500 for unexpected errors', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockGenerateMealPlan.mockRejectedValue(new Error('Something unexpected'))

    const response = await POST(createRequest({ startDate: '2026-02-02', endDate: '2026-02-09' }))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to generate meal plan')
  })
})
