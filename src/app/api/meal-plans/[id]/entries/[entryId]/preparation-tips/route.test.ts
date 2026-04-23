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
  getHouseholdMemberCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mealPlanEntry: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => (modelName: string) => ({ modelId: modelName })),
}))

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  retryAfterSeconds: vi.fn(() => 90),
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
import { getHouseholdMembership, getHouseholdMemberCount } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { generateObject } from 'ai'
import { checkRateLimit } from '@/lib/rate-limit'
import { assertUnderCap } from '@/lib/ai/usage'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockGetMemberCount = vi.mocked(getHouseholdMemberCount)
const mockEntryFindFirst = vi.mocked(prisma.mealPlanEntry.findFirst)
const mockEntryUpdate = vi.mocked(prisma.mealPlanEntry.update)
const mockGenerateObject = vi.mocked(generateObject)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockAssertUnderCap = vi.mocked(assertUnderCap)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
}

function buildMembership(locale: string = 'en') {
  return {
    id: 'member-123',
    householdId: 'household-123',
    userId: 'user-123',
    role: 'owner',
    household: {
      id: 'household-123',
      name: 'Test Household',
      timezone: 'Europe/Tallinn',
      locale,
      preferences: null,
    },
  }
}

const mockMembership = buildMembership()

function sampleEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    planId: 'plan-1',
    preparationTips: null,
    meal: {
      id: 'meal-1',
      name: 'Chicken stir fry',
      timeMinutes: 30,
      preparationNotes: null,
      components: [
        {
          quantityPerServing: 150,
          ingredient: { name: 'Chicken breast', defaultUnit: 'g' },
        },
      ],
    },
    ...overrides,
  }
}

function callPost(planId = 'plan-1', entryId = 'entry-1') {
  return POST(
    new Request(`http://localhost/api/meal-plans/${planId}/entries/${entryId}/preparation-tips`, {
      method: 'POST',
    }),
    { params: Promise.resolve({ id: planId, entryId }) },
  )
}

describe('POST /api/meal-plans/[id]/entries/[entryId]/preparation-tips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMemberCount.mockResolvedValue(4)
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 29,
      limit: 30,
      resetAt: new Date('2026-02-01T12:00:00.000Z'),
    })
    mockAssertUnderCap.mockResolvedValue(undefined)
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 429 with Retry-After header when rate limited (and cache miss)', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      limit: 30,
      resetAt: new Date('2026-02-01T12:00:00.000Z'),
    })

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('90')
    expect(data.error).toBe('Rate limit exceeded')
    expect(mockCheckRateLimit).toHaveBeenCalledWith('household-123', 'meal-prep-tips')
  })

  it('does NOT consume rate-limit tokens when returning cached tips', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    const cached = { equipment: ['P'], steps: ['S'], pitfalls: ['X'], tip: 'T' }
    mockEntryFindFirst.mockResolvedValue(
      sampleEntry({ preparationTips: JSON.stringify(cached) }) as never,
    )

    const response = await callPost()

    expect(response.status).toBe(200)
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })

  it('scopes entry lookup via plan.householdId and returns 404 when not found', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(null)

    const response = await callPost('plan-1', 'entry-1')
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Entry not found')
    expect(mockEntryFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'entry-1',
          planId: 'plan-1',
          plan: { householdId: 'household-123' },
        }),
      }),
    )
  })

  it('returns 400 when entry has no meal assigned', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry({ meal: null }) as never)

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('No meal assigned to this entry')
  })

  it('returns cached tips without calling AI when valid cache exists', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    const cached = {
      equipment: ['Pan'],
      steps: ['Heat'],
      pitfalls: ['Burn it'],
      tip: 'Go slow',
    }
    mockEntryFindFirst.mockResolvedValue(
      sampleEntry({ preparationTips: JSON.stringify(cached) }) as never,
    )

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.tips).toEqual(cached)
    expect(mockGenerateObject).not.toHaveBeenCalled()
    expect(mockEntryUpdate).not.toHaveBeenCalled()
  })

  it('regenerates when cached tips are in legacy format and persists new cache', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(
      sampleEntry({ preparationTips: 'legacy plain text tips' }) as never,
    )
    const fresh = {
      equipment: ['Wok'],
      steps: ['Step 1'],
      pitfalls: ['Overcook'],
    }
    mockGenerateObject.mockResolvedValue({ object: fresh } as never)

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.tips).toEqual(fresh)
    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
    expect(mockEntryUpdate).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      data: { preparationTips: JSON.stringify(fresh) },
    })
  })

  it('generates full tips when meal has no preparationNotes', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    const fullTips = {
      equipment: ['Pan'],
      steps: ['Step 1', 'Step 2'],
      pitfalls: ['Pitfall 1'],
      tip: 'One tip',
    }
    mockGenerateObject.mockResolvedValue({ object: fullTips } as never)

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.tips).toEqual(fullTips)
    // The prompt should NOT mention user's preparation notes
    const call = mockGenerateObject.mock.calls[0]?.[0] as { prompt: string }
    expect(call.prompt).not.toContain("User's preparation notes")
  })

  it('generates supplementary tips when meal has preparationNotes', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(
      sampleEntry({
        meal: {
          ...sampleEntry().meal,
          preparationNotes: 'My custom method: sear first then simmer',
        },
      }) as never,
    )
    const supplementary = {
      pitfalls: ['Watch the heat'],
      tip: 'Rest the meat',
    }
    mockGenerateObject.mockResolvedValue({ object: supplementary } as never)

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.tips).toEqual(supplementary)
    const call = mockGenerateObject.mock.calls[0]?.[0] as { prompt: string }
    expect(call.prompt).toContain("User's preparation notes")
  })

  it('returns 429 when AI throws rate-limit error', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    const aiError = Object.assign(new Error('rate limited'), { statusCode: 429 })
    mockGenerateObject.mockRejectedValue(aiError)

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(429)
    expect(data.error).toContain('AI service is busy')
  })

  it('returns 502 when AI is overloaded (status 529)', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    mockGenerateObject.mockRejectedValue(
      Object.assign(new Error('overloaded'), { statusCode: 529 }),
    )

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(502)
  })

  it('returns 502 when AI is unavailable (status 503)', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    mockGenerateObject.mockRejectedValue(
      Object.assign(new Error('unavailable'), { statusCode: 503 }),
    )

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(502)
  })

  it('returns 504 on TimeoutError', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    const err = new Error('timed out')
    err.name = 'TimeoutError'
    mockGenerateObject.mockRejectedValue(err)

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(504)
    expect(data.error).toContain('timed out')
  })

  it('returns 500 on generic AI failure', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    mockGenerateObject.mockRejectedValue(new Error('unexpected'))

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toContain("Couldn't generate tips")
  })

  it('threads household.locale into the AI prompt for non-English households', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(buildMembership('et') as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    mockGenerateObject.mockResolvedValue({
      object: { equipment: ['Pan'], steps: ['Step 1'], pitfalls: ['P'] },
    } as never)

    const response = await callPost()

    expect(response.status).toBe(200)
    const call = mockGenerateObject.mock.calls[0]?.[0] as { prompt: string }
    expect(call.prompt).toContain('LOCALE:')
    expect(call.prompt).toContain('Estonian')
  })

  it('does not inject a LOCALE block for English households (byte-identical English path)', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    mockGenerateObject.mockResolvedValue({
      object: { equipment: ['Pan'], steps: ['Step 1'], pitfalls: ['P'] },
    } as never)

    const response = await callPost()

    expect(response.status).toBe(200)
    const call = mockGenerateObject.mock.calls[0]?.[0] as { prompt: string }
    expect(call.prompt).not.toContain('LOCALE:')
  })
})
