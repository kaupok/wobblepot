import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

// What the entry's own ingredient changes do to the prompt (HON-1243,
// HON-1254). The rest of the route is in `route.test.ts`.

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
import { loadEntryForAi } from '@/lib/meal-plans/entry-context'
import { generateObject } from 'ai'
import { checkRateLimit } from '@/lib/rate-limit'
import { assertUnderCap } from '@/lib/ai/usage'
import { getServerFlag } from '@/lib/feature-flags'
import { STEPS_MODEL } from '@/lib/ai/models'
import { buildFullStepsRequest } from '@/lib/ai/preparation-steps'

const mockLoadEntry = vi.mocked(loadEntryForAi)
const mockGenerateObject = vi.mocked(generateObject)

const RULE = "The household changed this meal's ingredients, so the list above is what they cook"

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
  {
    ingredientId: 'ing-soy',
    quantityPerServing: 12.3,
    ingredient: { name: 'Soy sauce', defaultUnit: 'ml' },
  },
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
  locale: 'en',
}

/** A change that leaves out `originalIngredientId`, as `loadEntryForAi` returns it. */
const leaveOut = (originalIngredientId: string) => ({
  id: 'change-1',
  originalIngredientId,
  replacementIngredientId: null,
  quantityPerServing: null,
  replacementIngredient: null,
})

/**
 * `loadEntryForAi`'s result: `meal.components` is the shared recipe, and
 * `components` the recipe with the entry's `changes` merged.
 */
function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    planId: 'plan-1',
    mealId: 'meal-1',
    preparationTips: null,
    servingOverride: null,
    adjustmentNote: null,
    meal: {
      id: 'meal-1',
      name: 'Chicken stir fry',
      timeMinutes: 30,
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

describe("POST preparation-tips: the entry's ingredient changes", () => {
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
    mockGenerateObject.mockResolvedValue({
      object: { equipment: [], steps: [], pitfalls: [] },
    } as never)
  })

  // An entry's own ingredient changes reach the prompt, the shared recipe
  // does not: `loadEntryForAi` merges them into `components` (HON-1243).
  it("builds the prompt from the entry's merged components, not the meal's", async () => {
    mockLoadEntry.mockResolvedValue(entry({ components: components.slice(1) }) as never)

    await callPost()

    expect(mockGenerateObject.mock.calls[0]![0]).toEqual({
      ...buildFullStepsRequest({ ...builderInput, components: builderInput.components.slice(1) }),
      model: { modelId: STEPS_MODEL },
      abortSignal: expect.any(AbortSignal),
    })
  })

  // The meal's name can call for what the household left out ("with Garlic
  // and Chilli"), so the prompt says the merged list is the whole meal, but
  // only when a change applies (HON-1254).
  it('says the list is the whole meal when the entry has a live change', async () => {
    mockLoadEntry.mockResolvedValue(
      entry({
        changes: [leaveOut('ing-onion')],
        components: [components[0], components[2]],
      }) as never,
    )

    await callPost()

    expect(promptSent()).toContain(RULE)
    expect(promptSent()).not.toContain('Onion')
  })

  it('leaves the rule out when its only change is stale', async () => {
    mockLoadEntry.mockResolvedValue(
      entry({ changes: [leaveOut('ing-removed-from-recipe')] }) as never,
    )

    await callPost()

    expect(promptSent()).not.toContain(RULE)
    expect(promptSent()).toContain('Onion')
  })

  // A household's own recipe lists what the household wrote, so the forked
  // "Chicken stir fry (my version)" may lack what its name calls for, with no
  // change left on the entry (HON-1245).
  it("says the list is the whole meal on the household's own recipe without a change", async () => {
    const own = entry()
    mockLoadEntry.mockResolvedValue({
      ...own,
      meal: { ...own.meal, householdId: 'household-123' },
    } as never)

    await callPost()

    expect(promptSent()).toContain(RULE)
  })
})
