import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

// A meal with the household's notes gets full steps, with the notes as input
// (HON-1259). The rest of the route is in `route.test.ts`.

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
  loadHouseholdServings: vi.fn(),
}))

vi.mock('@/lib/meal-plans/entry-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/entry-context')>()),
  loadEntryForAi: vi.fn(),
  cachePreparationTips: vi.fn(),
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

vi.mock('@/lib/ai/usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/usage')>()),
  assertUnderCap: vi.fn(),
  recordAiUsage: vi.fn(),
}))

vi.mock('@/lib/feature-flags', () => ({
  getServerFlag: vi.fn(),
}))

vi.mock('@/lib/ai/sampling', () => ({
  logAiSample: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership, loadHouseholdServings } from '@/lib/household'
import { cachePreparationTips, loadEntryForAi } from '@/lib/meal-plans/entry-context'
import { generateObject } from 'ai'
import { checkRateLimit } from '@/lib/rate-limit'
import { assertUnderCap, recordAiUsage } from '@/lib/ai/usage'
import { getServerFlag } from '@/lib/feature-flags'
import { logAiSample } from '@/lib/ai/sampling'
import { STEPS_MODEL } from '@/lib/ai/models'
import { buildFullStepsRequest, buildStepsFromNotesRequest } from '@/lib/ai/preparation-steps'
import { serializePreparationSteps } from '@/lib/preparation-steps'
import { USAGE_FIXTURE, expectedUsageStats, noObjectGeneratedError } from '@/lib/ai/usage-fixture'

const mockLoadEntry = vi.mocked(loadEntryForAi)
const mockGenerateObject = vi.mocked(generateObject)
const mockRecordAiUsage = vi.mocked(recordAiUsage)

const NOTES = 'Sear the chicken at 220°C for 3 minutes.\nThen roast at 180°C for 20 minutes.'

const components = [
  {
    ingredientId: 'ing-chicken',
    quantityPerServing: 150,
    ingredient: { name: 'Chicken breast', defaultUnit: 'g' },
  },
  {
    ingredientId: 'ing-onion',
    quantityPerServing: 0.5,
    ingredient: { name: 'Onion', defaultUnit: 'piece' },
  },
]

const builderInput = {
  mealName: 'Roast chicken',
  servings: 4,
  timeMinutes: 30,
  components: components.map((c) => ({
    name: c.ingredient.name,
    quantityPerServing: c.quantityPerServing,
    defaultUnit: c.ingredient.defaultUnit,
  })),
  locale: 'en',
}

const fullTips = {
  equipment: ['Oven-safe frying pan'],
  steps: ['Sear the chicken at 220°C for 3 minutes.', 'Roast at 180°C for 20 minutes.'],
  pitfalls: ['Crowding the pan'],
  tip: 'Rest it for 5 minutes.',
}

/** `loadEntryForAi`'s result for a library meal with `preparationNotes`. */
function entry(overrides: Record<string, unknown> = {}, preparationNotes: string | null = NOTES) {
  return {
    id: 'entry-1',
    planId: 'plan-1',
    mealId: 'meal-1',
    preparationTips: null,
    servingOverride: null,
    cookedServings: null,
    leftoverItems: [],
    adjustmentNote: null,
    meal: {
      id: 'meal-1',
      name: 'Roast chicken',
      timeMinutes: 30,
      preparationNotes,
      householdId: null,
      updatedAt: new Date('2026-02-01T10:00:00.000Z'),
      components,
    },
    changes: [],
    components,
    ...overrides,
  }
}

function callPost() {
  return POST(
    new Request('http://localhost/api/meal-plans/plan-1/entries/entry-1/preparation-tips', {
      method: 'POST',
    }),
    { params: Promise.resolve({ id: 'plan-1', entryId: 'entry-1' }) },
  )
}

describe("POST preparation-tips: a meal with the household's notes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-123' },
      session: { id: 'session-123' },
    } as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue({
      householdId: 'household-123',
      userId: 'user-123',
      household: {
        id: 'household-123',
        locale: 'en',
        preferences: null,
        _count: { members: 4 },
        members: Array.from({ length: 4 }, () => ({ preferences: { portionMultiplier: 1 } })),
      },
    } as never)
    vi.mocked(loadHouseholdServings).mockResolvedValue(4)
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 29,
      limit: 30,
      resetAt: new Date('2026-02-01T12:00:00.000Z'),
    })
    vi.mocked(assertUnderCap).mockResolvedValue(undefined)
    vi.mocked(getServerFlag).mockResolvedValue(true)
    mockGenerateObject.mockResolvedValue({ object: fullTips, usage: USAGE_FIXTURE } as never)
  })

  // The model benchmark (HON-795) sends the builder's output, so the route
  // must send exactly it.
  it('sends exactly the request buildStepsFromNotesRequest builds, and returns its steps', async () => {
    mockLoadEntry.mockResolvedValue(entry() as never)

    const response = await callPost()

    expect(mockGenerateObject.mock.calls[0]![0]).toEqual({
      ...buildStepsFromNotesRequest({ ...builderInput, preparationNotes: NOTES }),
      model: { modelId: STEPS_MODEL },
      abortSignal: expect.any(AbortSignal),
    })
    expect(response.status).toBe(200)
    expect((await response.json()).tips).toEqual(fullTips)
    expect(vi.mocked(cachePreparationTips)).toHaveBeenCalledWith(
      expect.objectContaining({ entryId: 'entry-1' }),
      fullTips,
      4,
    )
  })

  it('sends the full request when the notes are blank', async () => {
    mockLoadEntry.mockResolvedValue(entry({}, '  \n ') as never)

    await callPost()

    expect(mockGenerateObject.mock.calls[0]![0]).toEqual({
      ...buildFullStepsRequest(builderInput),
      model: { modelId: STEPS_MODEL },
      abortSignal: expect.any(AbortSignal),
    })
  })

  // Before HON-1259 a meal with notes cached Watch out and Tip only. Served
  // as it is, the cook view would never show steps.
  it('regenerates a cached value with no steps', async () => {
    mockLoadEntry.mockResolvedValue(
      entry({
        preparationTips: serializePreparationSteps({ pitfalls: ['Old'], tip: 'Old tip' }, 4),
      }) as never,
    )

    const response = await callPost()

    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
    expect((await response.json()).tips).toEqual(fullTips)
  })

  it('serves a cached value with steps without calling the AI', async () => {
    mockLoadEntry.mockResolvedValue(
      entry({ preparationTips: serializePreparationSteps(fullTips, 4) }) as never,
    )

    const response = await callPost()

    expect(mockGenerateObject).not.toHaveBeenCalled()
    expect((await response.json()).tips).toEqual(fullTips)
  })

  it('records the SDK usage', async () => {
    mockLoadEntry.mockResolvedValue(entry() as never)

    await callPost()

    expect(mockRecordAiUsage).toHaveBeenCalledTimes(1)
    expect(mockRecordAiUsage).toHaveBeenCalledWith({
      householdId: 'household-123',
      feature: 'entry_preparation_tips',
      ...expectedUsageStats(STEPS_MODEL),
    })
  })

  it('records the billed usage with success: false on NoObjectGeneratedError', async () => {
    mockLoadEntry.mockResolvedValue(entry() as never)
    mockGenerateObject.mockRejectedValue(noObjectGeneratedError())

    const response = await callPost()

    expect(response.status).toBe(500)
    expect(mockRecordAiUsage).toHaveBeenCalledTimes(1)
    expect(mockRecordAiUsage).toHaveBeenCalledWith({
      householdId: 'household-123',
      feature: 'entry_preparation_tips',
      ...expectedUsageStats(STEPS_MODEL),
      success: false,
    })
  })

  it('logs a preparation-tips-from-notes sample', async () => {
    mockLoadEntry.mockResolvedValue(entry() as never)

    await callPost()

    expect(vi.mocked(logAiSample)).toHaveBeenCalledWith({
      callSite: 'preparation-tips-from-notes',
      locale: 'en',
      input: {
        mealName: 'Roast chicken',
        householdSize: 4,
        timeMinutes: 30,
        ingredientsCount: 2,
        hasUserNotes: true,
      },
      output: fullTips,
    })
  })
})
