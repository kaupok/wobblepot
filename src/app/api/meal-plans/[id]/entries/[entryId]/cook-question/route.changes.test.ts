import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

// What the entry's own ingredient changes do to the cook-question prompt
// (HON-1254). The rest of the route is in `route.test.ts`.

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/meal-plans/entry-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/entry-context')>()),
  loadEntryForAi: vi.fn(),
  loadPantryNamesForAi: vi.fn(),
  cachePreparationTips: vi.fn(),
}))

// The real `streamText` runs against a mock model that answers in one chunk.
vi.mock('@ai-sdk/anthropic', async () => {
  const { MockLanguageModelV4 } = await import('ai/test')
  return {
    createAnthropic: vi.fn(
      () => () =>
        new MockLanguageModelV4({
          doStream: async () => ({
            stream: new ReadableStream({
              start(controller) {
                for (const part of [
                  { type: 'stream-start', warnings: [] },
                  { type: 'text-start', id: 't1' },
                  { type: 'text-delta', id: 't1', delta: 'Use more oil.' },
                  { type: 'text-end', id: 't1' },
                  {
                    type: 'finish',
                    finishReason: { unified: 'stop', raw: 'end_turn' },
                    usage: {
                      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                      outputTokens: { total: 5, text: undefined, reasoning: undefined },
                    },
                  },
                ]) {
                  controller.enqueue(part as never)
                }
                controller.close()
              },
            }),
          }),
        }),
    ),
  }
})

// A spy around the real `streamText`, to read the request the route sends.
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return { ...actual, streamText: vi.fn(actual.streamText) }
})

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

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { loadEntryForAi, loadPantryNamesForAi } from '@/lib/meal-plans/entry-context'
import { streamText } from 'ai'
import { checkRateLimit } from '@/lib/rate-limit'
import { assertUnderCap } from '@/lib/ai/usage'
import { getServerFlag } from '@/lib/feature-flags'

const mockLoadEntry = vi.mocked(loadEntryForAi)
const mockStreamText = vi.mocked(streamText)

const RULE = "The household changed this meal's ingredients, so the list above is what they cook"

const chicken = {
  ingredientId: 'ing-chicken',
  quantityPerServing: 150,
  ingredient: { name: 'Chicken breast', defaultUnit: 'g' },
}
const garlic = {
  ingredientId: 'ing-garlic',
  quantityPerServing: 5,
  ingredient: { name: 'Garlic', defaultUnit: 'g' },
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
function entry(changes: unknown[], components: unknown[], householdId: string | null = null) {
  return {
    id: 'entry-1',
    planId: 'plan-1',
    mealId: 'meal-1',
    preparationTips: null,
    servingOverride: null,
    meal: {
      id: 'meal-1',
      name: 'Chicken with garlic',
      timeMinutes: 30,
      preparationNotes: null,
      householdId,
      components: [chicken, garlic],
    },
    changes,
    components,
  }
}

function callPost() {
  return POST(
    new Request('http://localhost/api/meal-plans/plan-1/entries/entry-1/cook-question', {
      method: 'POST',
      body: JSON.stringify({
        subject: { kind: 'step', index: 1 },
        steps: ['Slice the chicken.', 'Fry the chicken.'],
        equipment: ['Frying pan'],
        question: 'What can I substitute here?',
      }),
    }),
    { params: Promise.resolve({ id: 'plan-1', entryId: 'entry-1' }) },
  )
}

function promptSent(): string {
  return (mockStreamText.mock.calls[0]?.[0] as { prompt: string }).prompt
}

// The answers read the same merged list as the steps, so they get the same
// rule under the same condition: a live change, not a stale one. Without it
// "What can I substitute here?" answers about garlic the meal no longer has.
describe("POST cook-question: the entry's ingredient changes", () => {
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
    vi.mocked(loadPantryNamesForAi).mockResolvedValue([] as never)
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 59,
      limit: 60,
      resetAt: new Date('2026-02-01T12:00:00.000Z'),
    })
    vi.mocked(assertUnderCap).mockResolvedValue(undefined)
    vi.mocked(getServerFlag).mockResolvedValue(true)
  })

  it('says the list is the whole meal when the entry has a live change', async () => {
    mockLoadEntry.mockResolvedValue(entry([leaveOut('ing-garlic')], [chicken]) as never)

    const response = await callPost()

    expect(response.status).toBe(200)
    expect(promptSent()).toContain(RULE)
    expect(promptSent()).not.toContain('- Garlic')
  })

  it('leaves the rule out when its only change is stale', async () => {
    mockLoadEntry.mockResolvedValue(entry([leaveOut('ing-gone')], [chicken, garlic]) as never)

    const response = await callPost()

    expect(response.status).toBe(200)
    expect(promptSent()).not.toContain(RULE)
    expect(promptSent()).toContain('- Garlic')
  })

  // A household's own recipe lists what the household wrote, so "Chicken with
  // garlic (my version)" may have no garlic and no change left (HON-1245).
  it("says the list is the whole meal on the household's own recipe without a change", async () => {
    mockLoadEntry.mockResolvedValue(entry([], [chicken], 'household-123') as never)

    const response = await callPost()

    expect(response.status).toBe(200)
    expect(promptSent()).toContain(RULE)
  })

  it('leaves the rule out on a library meal without a change', async () => {
    mockLoadEntry.mockResolvedValue(entry([], [chicken, garlic]) as never)

    await callPost()

    expect(promptSent()).not.toContain(RULE)
  })
})
