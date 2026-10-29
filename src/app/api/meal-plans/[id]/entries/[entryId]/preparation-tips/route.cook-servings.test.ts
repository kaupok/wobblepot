import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from './route'

// What the leftover lunches a dinner feeds do to its tips (HON-1394): the
// dinner is cooked for them too, so its tips are priced at the cook servings.
// The rest of the route is in `route.test.ts`.

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

import { generateObject } from 'ai'

import { assertUnderCap } from '@/lib/ai/usage'
import { auth } from '@/lib/auth'
import { getServerFlag } from '@/lib/feature-flags'
import { getHouseholdMembership, loadHouseholdServings } from '@/lib/household'
import { cachePreparationTips, loadEntryForAi } from '@/lib/meal-plans/entry-context'
import { checkRateLimit } from '@/lib/rate-limit'

const mockLoadEntry = vi.mocked(loadEntryForAi)
const mockGenerateObject = vi.mocked(generateObject)
const mockCacheWrite = vi.mocked(cachePreparationTips)

const components = [
  {
    ingredientId: 'ing-lentils',
    quantityPerServing: 100,
    ingredient: { name: 'Red lentils', defaultUnit: 'g' },
  },
]

const cachedAt3 = {
  equipment: ['Pot'],
  steps: ['Simmer'],
  pitfalls: ['Scorching'],
  servings: 3,
}
const fresh = { equipment: ['Large pot'], steps: ['Simmer longer'], pitfalls: ['Boil-over'] }

/** A 3-serving dinner, as `loadEntryForAi` returns it, with its tips cached at 3. */
function dinner(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    planId: 'plan-1',
    mealId: 'meal-1',
    status: 'planned',
    preparationTips: JSON.stringify(cachedAt3),
    servingOverride: null,
    cookedServings: null,
    leftoverItems: [],
    adjustmentNote: null,
    meal: {
      id: 'meal-1',
      name: 'Lentil soup',
      timeMinutes: 40,
      preparationNotes: null,
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

function promptSent(): string {
  return (mockGenerateObject.mock.calls[0]![0] as { prompt: string }).prompt
}

describe('POST preparation-tips: the leftover lunches a dinner feeds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-123' },
      session: { id: 'session-123' },
    } as never)
    // Three adults: 3 servings of their own.
    vi.mocked(getHouseholdMembership).mockResolvedValue({
      householdId: 'household-123',
      userId: 'user-123',
      household: {
        id: 'household-123',
        locale: 'en',
        preferences: null,
        _count: { members: 3 },
        members: Array.from({ length: 3 }, () => ({ preferences: { portionMultiplier: 1 } })),
      },
    } as never)
    vi.mocked(loadHouseholdServings).mockResolvedValue(3)
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 29,
      limit: 30,
      resetAt: new Date('2026-02-01T12:00:00.000Z'),
    })
    vi.mocked(assertUnderCap).mockResolvedValue(undefined)
    vi.mocked(getServerFlag).mockResolvedValue(true)
    mockGenerateObject.mockResolvedValue({ object: fresh } as never)
  })

  it('serves tips cached at 3 while no lunch is linked', async () => {
    mockLoadEntry.mockResolvedValue(dinner() as never)

    const data = await (await callPost()).json()

    expect(data.tips).toEqual({ equipment: ['Pot'], steps: ['Simmer'], pitfalls: ['Scorching'] })
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  // A lunch at 2.5 linked after the tips were cached moves the total to 5.5,
  // so the next read makes tips for 5.5, not 3.
  it('makes new tips at 5.5 once a lunch at 2.5 is linked', async () => {
    mockLoadEntry.mockResolvedValue(dinner({ leftoverItems: [{ servings: 2.5 }] }) as never)

    const data = await (await callPost()).json()

    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
    expect(promptSent()).toContain('Servings: 5.5')
    expect(promptSent()).toContain('- Red lentils: 550g')
    expect(data.tips).toEqual(fresh)
    expect(mockCacheWrite).toHaveBeenCalledWith(expect.anything(), fresh, 5.5)
  })

  it('makes new tips at 7.5 for two lunches at 2.5 and 2', async () => {
    mockLoadEntry.mockResolvedValue(
      dinner({ leftoverItems: [{ servings: 2.5 }, { servings: 2 }] }) as never,
    )

    await callPost()

    expect(promptSent()).toContain('Servings: 7.5')
    expect(mockCacheWrite).toHaveBeenCalledWith(expect.anything(), fresh, 7.5)
  })
})
