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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mealPlanEntry: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    householdMember: {
      count: vi.fn(),
    },
  },
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => (modelName: string) => ({ modelId: modelName })),
}))

// Keep the real exports: `withUsageOnFailure` needs the real
// `NoObjectGeneratedError.isInstance` on every rejected call.
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
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

vi.mock('@/lib/feature-flags', () => ({
  getServerFlag: vi.fn(),
}))

vi.mock('@/lib/ai/sampling', () => ({
  logAiSample: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { generateObject } from 'ai'
import { checkRateLimit } from '@/lib/rate-limit'
import { AiCostCapExceededError, assertUnderCap, recordAiUsage } from '@/lib/ai/usage'
import { logAiSample } from '@/lib/ai/sampling'
import { getServerFlag } from '@/lib/feature-flags'
import { TIPS_MODEL } from '@/lib/ai/models'
import { buildFullTipsRequest, buildSupplementaryTipsRequest } from '@/lib/ai/preparation-tips'
import { USAGE_FIXTURE, expectedUsageStats, noObjectGeneratedError } from '@/lib/ai/usage-fixture'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockEntryFindFirst = vi.mocked(prisma.mealPlanEntry.findFirst)
const mockEntryUpdate = vi.mocked(prisma.mealPlanEntry.update)
/**
 * The cache write. Conditional (`updateMany`, not `update`) so that a
 * `servingOverride` or locale PATCH committing during the 45s generation wins:
 * that PATCH nulled the cache because the prompt's inputs moved, and writing
 * anyway would put the stale tips straight back, where every later read is a
 * cache hit (HON-681).
 */
const mockEntryCacheWrite = vi.mocked(prisma.mealPlanEntry.updateMany)
/**
 * The member-count re-read that guards the cache write against a membership
 * change committing during the 45s generation. The count is a priced-from input
 * whenever the entry has no `servingOverride`, but it cannot join the `where`
 * (Prisma has no relation `_count` filter) and the membership invalidation
 * cannot see a row that is still `preparationTips: null` (HON-684).
 */
const mockMemberCount = vi.mocked(prisma.householdMember.count)
const mockGenerateObject = vi.mocked(generateObject)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockAssertUnderCap = vi.mocked(assertUnderCap)
const mockRecordAiUsage = vi.mocked(recordAiUsage)
const mockLogAiSample = vi.mocked(logAiSample)
const mockGetServerFlag = vi.mocked(getServerFlag)

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
      // The route reads the household size off this `_count` (HON-596) rather
      // than issuing a second `household_member` count.
      _count: { members: 4 },
    },
  }
}

const mockMembership = buildMembership()

const MEAL_UPDATED_AT = new Date('2026-02-01T10:00:00.000Z')

function sampleEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    planId: 'plan-1',
    mealId: 'meal-1',
    preparationTips: null,
    // A real row always carries the column, and the cache write filters on it
    // (HON-681) — leaving it off would make that filter `undefined`, which
    // Prisma reads as "no filter at all".
    servingOverride: null,
    meal: {
      id: 'meal-1',
      name: 'Chicken stir fry',
      timeMinutes: 30,
      preparationNotes: null,
      // Same reason as `servingOverride` above: the cache write filters on it
      // so that a meal edit committing mid-generation wins (HON-683), and an
      // absent column would make that filter `undefined` — no filter at all.
      updatedAt: MEAL_UPDATED_AT,
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
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 29,
      limit: 30,
      resetAt: new Date('2026-02-01T12:00:00.000Z'),
    })
    mockAssertUnderCap.mockResolvedValue(undefined)
    // Unchanged membership is the default: the re-read agrees with the
    // `_count.members` the prompt was priced from, so the cache write proceeds.
    mockMemberCount.mockResolvedValue(4 as never)
    mockGetServerFlag.mockResolvedValue(true)
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
    expect(data.code).toBe('unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
    expect(data.code).toBe('no_household')
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
    expect(data.code).toBe('rate_limited')
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
    expect(data.code).toBe('entry_not_found')
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
    expect(data.code).toBe('no_meal')
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
    expect(mockEntryCacheWrite).not.toHaveBeenCalled()
  })

  // `useMealTips` renders from `code`, so the shared cap response must carry the
  // one `PREPARATION_TIPS_ERROR_KEYS` maps (HON-888).
  it('returns 429 with code ai_cap_exceeded when the household is over its AI cap', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    mockAssertUnderCap.mockRejectedValue(
      new AiCostCapExceededError(new Date(Date.now() + 86_400_000), 'Europe/Tallinn'),
    )

    const response = await callPost()

    expect(response.status).toBe(429)
    expect((await response.json()).code).toBe('ai_cap_exceeded')
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  describe('ai_generation_enabled off (HON-868)', () => {
    beforeEach(() => {
      mockGetSession.mockResolvedValue(mockSession as never)
      mockGetMembership.mockResolvedValue(mockMembership as never)
      mockGetServerFlag.mockResolvedValue(false)
    })

    it('returns 503 without calling the model on a cache miss', async () => {
      mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)

      const response = await callPost()

      expect(response.status).toBe(503)
      expect((await response.json()).code).toBe('generation_disabled')
      expect(mockGetServerFlag).toHaveBeenCalledWith('ai_generation_enabled', 'user-123')
      expect(mockAssertUnderCap).not.toHaveBeenCalled()
      expect(mockGenerateObject).not.toHaveBeenCalled()
      expect(mockEntryCacheWrite).not.toHaveBeenCalled()
    })

    it('still returns stored tips', async () => {
      const cached = { equipment: ['Pan'], steps: ['Heat'], pitfalls: ['Burn it'], tip: 'Go slow' }
      mockEntryFindFirst.mockResolvedValue(
        sampleEntry({ preparationTips: JSON.stringify(cached) }) as never,
      )

      const response = await callPost()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.tips).toEqual(cached)
      expect(mockGenerateObject).not.toHaveBeenCalled()
    })
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
    expect(mockEntryCacheWrite).toHaveBeenCalledWith({
      where: {
        id: 'entry-1',
        mealId: 'meal-1',
        servingOverride: null,
        plan: { household: { locale: 'en' } },
        meal: { is: { updatedAt: MEAL_UPDATED_AT } },
      },
      data: { preparationTips: JSON.stringify(fresh) },
    })
  })

  it('scopes the cache write to the meal, servings and locale the prompt was priced from', async () => {
    // Generation takes up to 45s. A `servingOverride` or locale PATCH that
    // commits in the meantime nulls this cache precisely because those inputs
    // moved, so the write has to lose that race rather than re-cache tips for
    // a count nobody is cooking — which no later read would ever regenerate,
    // because a cache hit short-circuits above (HON-681).
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(buildMembership('et') as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry({ servingOverride: 6 }) as never)
    const fresh = { equipment: ['Wok'], steps: ['Sear'], pitfalls: ['Crowding'] }
    mockGenerateObject.mockResolvedValue({ object: fresh } as never)

    const response = await callPost()

    expect(response.status).toBe(200)
    expect(mockEntryUpdate).not.toHaveBeenCalled()
    expect(mockEntryCacheWrite).toHaveBeenCalledWith({
      where: {
        id: 'entry-1',
        mealId: 'meal-1',
        servingOverride: 6,
        plan: { household: { locale: 'et' } },
        meal: { is: { updatedAt: MEAL_UPDATED_AT } },
      },
      data: { preparationTips: JSON.stringify(fresh) },
    })
  })

  it('scopes the cache write to the meal contents the prompt was priced from', async () => {
    // The meal PATCH is the fourth writer that nulls this cache, and it moves
    // the meal's *contents* — name, time, notes, components — while `mealId`
    // stays put, so the three filters above would all still match and the
    // pre-edit tips would land right back on the entry, permanently (HON-683).
    // `Meal.updatedAt` is the field that moves on such an edit.
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    const fresh = { equipment: ['Wok'], steps: ['Sear'], pitfalls: ['Crowding'] }
    mockGenerateObject.mockResolvedValue({ object: fresh } as never)

    const response = await callPost()

    expect(response.status).toBe(200)
    expect(mockEntryCacheWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ meal: { is: { updatedAt: MEAL_UPDATED_AT } } }),
      }),
    )
  })

  it('skips the cache write when the member count moved during generation', async () => {
    // The count priced this prompt (no `servingOverride`), and it cannot be
    // pinned in the `where` — Prisma has no relation `_count` filter. The
    // membership invalidation cannot cover the gap either: this row is still
    // `preparationTips: null` while it generates, so that `updateMany` matches
    // nothing. Writing anyway would cache tips for the old household size
    // permanently, because every later read is a cache hit (HON-684).
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    const fresh = { equipment: ['Wok'], steps: ['Sear'], pitfalls: ['Crowding'] }
    mockGenerateObject.mockResolvedValue({ object: fresh } as never)
    // A member joined at t+5s: 4 when priced, 5 now.
    mockMemberCount.mockResolvedValue(5 as never)

    const response = await callPost()
    const data = await response.json()

    // The caller still gets what it asked for — only the cache is guarded.
    expect(response.status).toBe(200)
    expect(data.tips).toEqual(fresh)
    expect(mockEntryCacheWrite).not.toHaveBeenCalled()
  })

  it('skips the cache write when a member left during generation', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    mockGenerateObject.mockResolvedValue({
      object: { equipment: ['Wok'], steps: ['Sear'], pitfalls: ['Crowding'] },
    } as never)
    mockMemberCount.mockResolvedValue(3 as never)

    const response = await callPost()

    expect(response.status).toBe(200)
    expect(mockEntryCacheWrite).not.toHaveBeenCalled()
  })

  it('does not re-read the member count when the entry has a serving override', async () => {
    // An override priced the prompt, so the member count never entered it and a
    // membership change cannot have invalidated these tips.
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry({ servingOverride: 6 }) as never)
    const fresh = { equipment: ['Wok'], steps: ['Sear'], pitfalls: ['Crowding'] }
    mockGenerateObject.mockResolvedValue({ object: fresh } as never)
    // Would fail the comparison if it were consulted at all.
    mockMemberCount.mockResolvedValue(99 as never)

    const response = await callPost()

    expect(response.status).toBe(200)
    expect(mockMemberCount).not.toHaveBeenCalled()
    expect(mockEntryCacheWrite).toHaveBeenCalledTimes(1)
  })

  it('caches normally when the member count is unchanged', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    const fresh = { equipment: ['Wok'], steps: ['Sear'], pitfalls: ['Crowding'] }
    mockGenerateObject.mockResolvedValue({ object: fresh } as never)
    mockMemberCount.mockResolvedValue(4 as never)

    const response = await callPost()

    expect(response.status).toBe(200)
    expect(mockMemberCount).toHaveBeenCalledWith({ where: { householdId: 'household-123' } })
    expect(mockEntryCacheWrite).toHaveBeenCalledTimes(1)
  })

  it('still returns the generated tips when the cache write matches nothing', async () => {
    // The caller asked for tips and the generation succeeded; only the cache is
    // guarded, so a lost race costs a regeneration next time, not an error.
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry({ servingOverride: 6 }) as never)
    const fresh = { equipment: ['Wok'], steps: ['Sear'], pitfalls: ['Crowding'] }
    mockGenerateObject.mockResolvedValue({ object: fresh } as never)
    mockEntryCacheWrite.mockResolvedValue({ count: 0 } as never)

    const response = await callPost()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.tips).toEqual(fresh)
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

  describe('request builders (HON-796)', () => {
    // Fractional and `piece` quantities, so the ingredient-list scaling,
    // rounding and `pcs` label are part of what is compared.
    const components = [
      { quantityPerServing: 150, ingredient: { name: 'Chicken breast', defaultUnit: 'g' } },
      { quantityPerServing: 0.5, ingredient: { name: 'Onion', defaultUnit: 'piece' } },
      { quantityPerServing: 12.3, ingredient: { name: 'Soy sauce', defaultUnit: 'ml' } },
    ]
    const builderInput = {
      mealName: 'Chicken stir fry',
      servings: 4,
      timeMinutes: 30,
      components: components.map((c) => ({
        name: c.ingredient.name,
        quantityPerServing: c.quantityPerServing,
        defaultUnit: c.ingredient.defaultUnit,
      })),
      locale: 'et',
    }

    beforeEach(() => {
      mockGetSession.mockResolvedValue(mockSession as never)
      mockGetMembership.mockResolvedValue(buildMembership('et') as never)
    })

    // The model benchmark (HON-795) sends the builder's output. If the route
    // adds an argument, or builds any of these inline, the two drift apart.
    it('sends exactly the request buildFullTipsRequest builds, plus model and signal', async () => {
      mockEntryFindFirst.mockResolvedValue(
        sampleEntry({ meal: { ...sampleEntry().meal, components } }) as never,
      )
      mockGenerateObject.mockResolvedValue({
        object: { equipment: [], steps: [], pitfalls: [] },
      } as never)

      await callPost()

      expect(mockGenerateObject.mock.calls[0]![0]).toEqual({
        ...buildFullTipsRequest(builderInput),
        model: { modelId: TIPS_MODEL },
        abortSignal: expect.any(AbortSignal),
      })
    })

    it('sends exactly the request buildSupplementaryTipsRequest builds, plus model and signal', async () => {
      const preparationNotes = 'Sear the chicken first, then simmer.'
      mockEntryFindFirst.mockResolvedValue(
        sampleEntry({ meal: { ...sampleEntry().meal, components, preparationNotes } }) as never,
      )
      mockGenerateObject.mockResolvedValue({ object: { pitfalls: [], tip: 'Rest it' } } as never)

      await callPost()

      expect(mockGenerateObject.mock.calls[0]![0]).toEqual({
        ...buildSupplementaryTipsRequest({ ...builderInput, preparationNotes }),
        model: { modelId: TIPS_MODEL },
        abortSignal: expect.any(AbortSignal),
      })
    })
  })

  it('records the SDK usage via toAiUsageStats for full tips', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    mockGenerateObject.mockResolvedValue({
      object: { equipment: [], steps: ['Step 1'], pitfalls: [], tip: 'Tip' },
      usage: USAGE_FIXTURE,
    } as never)

    await callPost()

    expect(mockRecordAiUsage).toHaveBeenCalledTimes(1)
    expect(mockRecordAiUsage).toHaveBeenCalledWith({
      householdId: mockMembership.household.id,
      feature: 'entry_preparation_tips',
      ...expectedUsageStats(TIPS_MODEL),
    })
  })

  it('records the SDK usage via toAiUsageStats for supplementary tips', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(
      sampleEntry({
        meal: { ...sampleEntry().meal, preparationNotes: 'Sear first then simmer' },
      }) as never,
    )
    mockGenerateObject.mockResolvedValue({
      object: { pitfalls: [], tip: 'Rest the meat' },
      usage: USAGE_FIXTURE,
    } as never)

    await callPost()

    expect(mockRecordAiUsage).toHaveBeenCalledTimes(1)
    expect(mockRecordAiUsage).toHaveBeenCalledWith({
      householdId: mockMembership.household.id,
      feature: 'entry_preparation_tips',
      ...expectedUsageStats(TIPS_MODEL),
    })
  })

  it('records the billed usage with success: false when full tips throw NoObjectGeneratedError', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    mockGenerateObject.mockRejectedValue(noObjectGeneratedError())

    const response = await callPost()

    // The error is rethrown as-is, so the route's generic mapping is unchanged.
    expect(response.status).toBe(500)
    expect(mockRecordAiUsage).toHaveBeenCalledTimes(1)
    expect(mockRecordAiUsage).toHaveBeenCalledWith({
      householdId: mockMembership.household.id,
      feature: 'entry_preparation_tips',
      ...expectedUsageStats(TIPS_MODEL),
      success: false,
    })
  })

  it('records the billed usage with success: false when supplementary tips throw NoObjectGeneratedError', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(
      sampleEntry({
        meal: { ...sampleEntry().meal, preparationNotes: 'Sear first then simmer' },
      }) as never,
    )
    mockGenerateObject.mockRejectedValue(noObjectGeneratedError())

    const response = await callPost()

    expect(response.status).toBe(500)
    expect(mockRecordAiUsage).toHaveBeenCalledTimes(1)
    expect(mockRecordAiUsage).toHaveBeenCalledWith({
      householdId: mockMembership.household.id,
      feature: 'entry_preparation_tips',
      ...expectedUsageStats(TIPS_MODEL),
      success: false,
    })
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
    expect(data.code).toBe('provider_busy')
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
    expect(data.code).toBe('provider_unavailable')
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
    expect(data.code).toBe('provider_unavailable')
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
    expect(data.code).toBe('tips_timeout')
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
    expect(data.code).toBe('tips_failed')
    // Only NoObjectGeneratedError is billed-but-failed; other errors record nothing.
    expect(mockRecordAiUsage).not.toHaveBeenCalled()
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

  it('builds the prompt from the entry servingOverride, not the raw member count', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    // Household of 4 cooking this entry for 6. The card, pantry row and
    // shopping row all scale by 6 (HON-614) — the tips are cached onto the
    // entry, so the prompt has to agree or it advises on 2/3 of the food.
    mockEntryFindFirst.mockResolvedValue(sampleEntry({ servingOverride: 6 }) as never)
    mockGenerateObject.mockResolvedValue({
      object: { equipment: ['Pan'], steps: ['Step 1'], pitfalls: ['P'] },
    } as never)

    const response = await callPost()

    expect(response.status).toBe(200)
    const call = mockGenerateObject.mock.calls[0]?.[0] as { prompt: string }
    expect(call.prompt).toContain('Servings: 6')
    expect(call.prompt).toContain('- Chicken breast: 900g')
    expect(mockLogAiSample.mock.calls[0]![0].input).toMatchObject({ householdSize: 6 })
  })

  it('falls back to the member count for the prompt when no servingOverride is set', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry({ servingOverride: null }) as never)
    mockGenerateObject.mockResolvedValue({
      object: { equipment: ['Pan'], steps: ['Step 1'], pitfalls: ['P'] },
    } as never)

    const response = await callPost()

    expect(response.status).toBe(200)
    const call = mockGenerateObject.mock.calls[0]?.[0] as { prompt: string }
    expect(call.prompt).toContain('Servings: 4')
    expect(call.prompt).toContain('- Chicken breast: 600g')
  })

  it('logs a preparation-tips-full sample when locale is non-default and meal has no notes', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(buildMembership('et') as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    const fullTips = {
      equipment: ['Pann'],
      steps: ['Eelsoojendage ahi 200°C-ni'],
      pitfalls: ['Mitte üle küpsetada'],
      tip: 'Lase enne lõikamist puhata',
    }
    mockGenerateObject.mockResolvedValue({ object: fullTips } as never)

    await callPost()

    expect(mockLogAiSample).toHaveBeenCalledTimes(1)
    const args = mockLogAiSample.mock.calls[0]![0]
    expect(args.callSite).toBe('preparation-tips-full')
    expect(args.locale).toBe('et')
    expect(args.input).toEqual({
      mealName: 'Chicken stir fry',
      householdSize: 4,
      timeMinutes: 30,
      ingredientsCount: 1,
      hasUserNotes: false,
    })
    expect(args.output).toEqual(fullTips)
  })

  it('logs a preparation-tips-supplementary sample when locale is non-default and meal has user notes', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(buildMembership('et') as never)
    mockEntryFindFirst.mockResolvedValue(
      sampleEntry({
        meal: {
          ...sampleEntry().meal,
          preparationNotes: 'Eestikeelsed märkused valmistamise kohta',
        },
      }) as never,
    )
    const supplementary = {
      pitfalls: ['Hoia silma peal'],
      tip: 'Lisa soola lõpus',
    }
    mockGenerateObject.mockResolvedValue({ object: supplementary } as never)

    await callPost()

    expect(mockLogAiSample).toHaveBeenCalledTimes(1)
    const args = mockLogAiSample.mock.calls[0]![0]
    expect(args.callSite).toBe('preparation-tips-supplementary')
    expect(args.locale).toBe('et')
    expect((args.input as { hasUserNotes: boolean }).hasUserNotes).toBe(true)
    expect(args.output).toEqual(supplementary)
  })
})
