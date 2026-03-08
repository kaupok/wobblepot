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

vi.mock('@/lib/meal-planning/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  recordGeneration: vi.fn(),
}))

vi.mock('@/lib/ai/generate-plan', () => ({
  generateMealPlan: vi.fn(),
  createEmptyPlan: vi.fn(),
  fillEmptySlots: vi.fn(),
}))

vi.mock('@/lib/meal-planning/dates', () => ({
  getNextMonday: vi.fn(() => new Date('2026-02-02T00:00:00.000Z')),
  getCurrentWeekMonday: vi.fn(() => new Date('2026-01-26T00:00:00.000Z')),
  getMondayOfWeek: vi.fn((date: Date) => {
    // Compute actual Monday of week for the given date
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    const dayOfWeek = d.getDay()
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    d.setDate(d.getDate() - daysSinceMonday)
    return d
  }),
  isMonday: vi.fn(() => false),
  isSunday: vi.fn(() => false),
  parseLocalDate: vi.fn((s: string) => new Date(`${s}T00:00:00.000Z`)),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { checkRateLimit, recordGeneration } from '@/lib/meal-planning/rate-limit'
import { generateMealPlan, createEmptyPlan, fillEmptySlots } from '@/lib/ai/generate-plan'
import {
  isSunday,
  isMonday,
  parseLocalDate,
  getMondayOfWeek,
  getCurrentWeekMonday,
} from '@/lib/meal-planning/dates'
import {
  MealPlanValidationError,
  InsufficientCandidatesError,
  NoEmptySlotsError,
} from '@/lib/ai/types'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockRecordGeneration = vi.mocked(recordGeneration)
const mockGenerateMealPlan = vi.mocked(generateMealPlan)
const mockCreateEmptyPlan = vi.mocked(createEmptyPlan)
const mockFillEmptySlots = vi.mocked(fillEmptySlots)
const mockIsSunday = vi.mocked(isSunday)
const mockIsMonday = vi.mocked(isMonday)
const mockParseLocalDate = vi.mocked(parseLocalDate)
const mockGetMondayOfWeek = vi.mocked(getMondayOfWeek)
const mockGetCurrentWeekMonday = vi.mocked(getCurrentWeekMonday)

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
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 4 })
    mockIsSunday.mockReturnValue(false)
    mockIsMonday.mockReturnValue(false)
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

  it('returns 429 when rate limited', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockCheckRateLimit.mockReturnValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date('2026-02-01T12:00:00.000Z'),
    })

    const response = await POST(createRequest())
    const data = await response.json()

    expect(response.status).toBe(429)
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

  it('returns 400 for invalid startDate format', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await POST(createRequest({ startDate: 'not-a-date' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.startDate).toBeDefined()
  })

  it('returns 400 when startDate is not a Monday', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockParseLocalDate.mockReturnValue(new Date('2026-02-03T00:00:00.000Z'))
    mockIsMonday.mockReturnValue(false)

    const response = await POST(createRequest({ startDate: '2026-02-03' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Start date must be a Monday')
  })

  it('returns 400 when generating current week on Sunday', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockIsSunday.mockReturnValue(true)

    const response = await POST(createRequest({ targetWeek: 'current' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('Cannot generate current week plan on Sunday')
  })

  it('returns 200 with generated plan for next week (default)', async () => {
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

    const response = await POST(createRequest({}))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.id).toBe('plan-123')
    expect(data.weekContext.type).toBe('next')
    expect(data.weekContext.daysCount).toBe(2)
    expect(mockRecordGeneration).toHaveBeenCalledWith('household-123', 'plan-generation')
  })

  it('returns 200 for empty mode', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const mockResult = { id: 'plan-empty', startDate: '2026-02-02', endDate: '2026-02-09' }
    mockCreateEmptyPlan.mockResolvedValue(mockResult as never)

    const response = await POST(createRequest({ mode: 'empty' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.id).toBe('plan-empty')
    expect(data.weekContext.type).toBe('next')
    expect(data.weekContext.daysCount).toBe(0)
    expect(mockRecordGeneration).toHaveBeenCalledWith('household-123', 'plan-generation')
  })

  it('returns 400 for fill-empty mode without planId', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await POST(createRequest({ mode: 'fill-empty' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('planId is required for fill-empty mode')
  })

  it('returns 200 for fill-empty mode with planId', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const mockResult = {
      id: 'plan-123',
      entries: [{ id: 'entry-new', date: '2026-02-04', mealType: 'dinner', status: 'planned' }],
    }
    mockFillEmptySlots.mockResolvedValue(mockResult as never)

    const response = await POST(createRequest({ mode: 'fill-empty', planId: 'plan-123' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.id).toBe('plan-123')
    expect(mockRecordGeneration).toHaveBeenCalledWith('household-123', 'plan-generation')
  })

  it('returns 422 when AI validation fails', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockGenerateMealPlan.mockRejectedValue(new MealPlanValidationError('Invalid AI response'))

    const response = await POST(createRequest({}))
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.error).toBe('AI generated an invalid meal plan')
  })

  it('returns 422 when insufficient candidates', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockGenerateMealPlan.mockRejectedValue(new InsufficientCandidatesError('Not enough fish meals'))

    const response = await POST(createRequest({}))
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.error).toBe('Insufficient meal options')
  })

  it('returns 409 when plan already exists (Prisma unique constraint)', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const prismaError = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    mockGenerateMealPlan.mockRejectedValue(prismaError)

    const response = await POST(createRequest({}))
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('A meal plan already exists for this week')
  })

  it('returns 400 for fill-empty NoEmptySlotsError', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFillEmptySlots.mockRejectedValue(new NoEmptySlotsError())

    const response = await POST(createRequest({ mode: 'fill-empty', planId: 'plan-123' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('No empty slots to fill')
  })

  it('returns 500 for unexpected errors', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockGenerateMealPlan.mockRejectedValue(new Error('Something unexpected'))

    const response = await POST(createRequest({}))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to generate meal plan')
  })

  describe('planFromDate parameter', () => {
    it('uses planFromDate to compute startDate and effectiveStartDate', async () => {
      mockGetSession.mockResolvedValue(mockSession as never)
      mockGetMembership.mockResolvedValue(mockMembership as never)
      // Wednesday Feb 18 2026 — not a Monday
      mockParseLocalDate.mockReturnValue(new Date('2026-02-18T00:00:00.000Z'))
      mockIsMonday.mockReturnValue(false)
      mockGetMondayOfWeek.mockReturnValue(new Date('2026-02-16T00:00:00.000Z'))

      const mockResult = {
        id: 'plan-123',
        startDate: '2026-02-16',
        endDate: '2026-02-23',
        entries: [{ id: 'entry-1', date: '2026-02-18', mealType: 'dinner', status: 'planned' }],
      }
      mockGenerateMealPlan.mockResolvedValue(mockResult as never)

      const response = await POST(createRequest({ planFromDate: '2026-02-18' }))

      expect(response.status).toBe(200)
      // Should pass effectiveStartDate to generateMealPlan
      expect(mockGenerateMealPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          effectiveStartDate: expect.any(Date),
        }),
      )
    })

    it('does not set effectiveStartDate when planFromDate is a Monday', async () => {
      mockGetSession.mockResolvedValue(mockSession as never)
      mockGetMembership.mockResolvedValue(mockMembership as never)
      // Monday Feb 16 2026
      mockParseLocalDate.mockReturnValue(new Date('2026-02-16T00:00:00.000Z'))
      mockIsMonday.mockReturnValue(true)
      mockGetMondayOfWeek.mockReturnValue(new Date('2026-02-16T00:00:00.000Z'))

      const mockResult = {
        id: 'plan-123',
        startDate: '2026-02-16',
        endDate: '2026-02-23',
        entries: [{ id: 'entry-1', date: '2026-02-16', mealType: 'dinner', status: 'planned' }],
      }
      mockGenerateMealPlan.mockResolvedValue(mockResult as never)

      const response = await POST(createRequest({ planFromDate: '2026-02-16' }))

      expect(response.status).toBe(200)
      expect(mockGenerateMealPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          effectiveStartDate: undefined,
        }),
      )
    })

    it('returns 400 when planFromDate resolves to current week on Sunday', async () => {
      mockGetSession.mockResolvedValue(mockSession as never)
      mockGetMembership.mockResolvedValue(mockMembership as never)
      mockIsSunday.mockReturnValue(true)
      // Sunday Feb 22 2026 — resolves to current week Monday (Feb 16)
      mockParseLocalDate.mockReturnValue(new Date('2026-02-22T00:00:00.000Z'))
      mockIsMonday.mockReturnValue(false)
      // Both return Feb 16 → same week → targetWeek = 'current'
      mockGetMondayOfWeek.mockReturnValue(new Date('2026-02-16T00:00:00.000Z'))
      mockGetCurrentWeekMonday.mockReturnValue(new Date('2026-02-16T00:00:00.000Z'))

      const response = await POST(createRequest({ planFromDate: '2026-02-22' }))
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('Cannot generate current week plan on Sunday')
    })

    it('allows planFromDate on Sunday when it resolves to next week', async () => {
      mockGetSession.mockResolvedValue(mockSession as never)
      mockGetMembership.mockResolvedValue(mockMembership as never)
      mockIsSunday.mockReturnValue(true)
      // Next Monday Feb 23 2026 — resolves to next week
      mockParseLocalDate.mockReturnValue(new Date('2026-02-23T00:00:00.000Z'))
      mockIsMonday.mockReturnValue(true)
      mockGetMondayOfWeek.mockReturnValue(new Date('2026-02-23T00:00:00.000Z'))
      mockGetCurrentWeekMonday.mockReturnValue(new Date('2026-02-16T00:00:00.000Z'))

      const mockResult = {
        id: 'plan-123',
        startDate: '2026-02-23',
        endDate: '2026-03-02',
        entries: [{ id: 'entry-1', date: '2026-02-23', mealType: 'dinner', status: 'planned' }],
      }
      mockGenerateMealPlan.mockResolvedValue(mockResult as never)

      const response = await POST(createRequest({ planFromDate: '2026-02-23' }))
      expect(response.status).toBe(200)
    })

    it('returns 400 for invalid planFromDate format', async () => {
      mockGetSession.mockResolvedValue(mockSession as never)
      mockGetMembership.mockResolvedValue(mockMembership as never)

      const response = await POST(createRequest({ planFromDate: 'not-a-date' }))
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Validation failed')
      expect(data.details.planFromDate).toBeDefined()
    })
  })
})
