import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from './route'

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

// The lib seam, with the real error class, request builder and freshness
// check. Which meals the loader refuses (another household's, a deleted one)
// is tested against a database in `recipe-steps.db.test.ts`. The write is
// mocked so the tests can assert the route never makes it.
vi.mock('@/lib/meals/recipe-steps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meals/recipe-steps')>()),
  loadRecipeForSteps: vi.fn(),
  saveRecipeSteps: vi.fn(),
}))

vi.mock('@/lib/meal-plans/entry-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/entry-context')>()),
  loadPantryNamesForAi: vi.fn(),
}))

// The real `streamText` runs against a mock model, as in the entry route's test.
const model = vi.hoisted(() => ({ parts: [] as unknown[] }))

vi.mock('@ai-sdk/anthropic', async () => {
  const { MockLanguageModelV4 } = await import('ai/test')
  return {
    createAnthropic: vi.fn(
      () => () =>
        new MockLanguageModelV4({
          doStream: async () => ({
            stream: new ReadableStream({
              start(controller) {
                for (const part of model.parts) controller.enqueue(part as never)
                controller.close()
              },
            }),
          }),
        }),
    ),
  }
})

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

import { streamText } from 'ai'

import { logAiSample } from '@/lib/ai/sampling'
import { AiCostCapExceededError, assertUnderCap, recordAiUsage } from '@/lib/ai/usage'
import { auth } from '@/lib/auth'
import { getServerFlag } from '@/lib/feature-flags'
import { getHouseholdMembership } from '@/lib/household'
import { loadPantryNamesForAi } from '@/lib/meal-plans/entry-context'
import {
  loadRecipeForSteps,
  RecipeStepsError,
  recipeStepsRequest,
  saveRecipeSteps,
} from '@/lib/meals/recipe-steps'
import { checkRateLimit } from '@/lib/rate-limit'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockLoadRecipe = vi.mocked(loadRecipeForSteps)
const mockLoadPantry = vi.mocked(loadPantryNamesForAi)
const mockStreamText = vi.mocked(streamText)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockAssertUnderCap = vi.mocked(assertUnderCap)
const mockGetServerFlag = vi.mocked(getServerFlag)

const SESSION = { user: { id: 'user-1' }, session: { id: 'session-1' } }

const PROVIDER_USAGE = {
  inputTokens: { total: 1531, noCache: 1031, cacheRead: 500, cacheWrite: 0 },
  outputTokens: { total: 787, text: undefined, reasoning: undefined },
}

function answerParts(chunks: string[]) {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't1' },
    ...chunks.map((delta) => ({ type: 'text-delta', id: 't1', delta })),
    { type: 'text-end', id: 't1' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage: PROVIDER_USAGE },
  ]
}

/** Two adults and a child: 2.5 servings (HON-1040). */
function membership(preferences: Record<string, unknown> | null = null) {
  return {
    household: {
      id: 'household-1',
      locale: 'en',
      preferences,
      _count: { members: 3 },
      members: [
        { preferences: { portionMultiplier: 1 } },
        { preferences: { portionMultiplier: 1 } },
        { preferences: { portionMultiplier: 0.5 } },
      ],
    },
  }
}

type Recipe = Awaited<ReturnType<typeof loadRecipeForSteps>>

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'meal-1',
    householdId: 'household-1',
    name: 'Pasta',
    timeMinutes: 20,
    preparationNotes: null,
    components: [
      {
        quantityPerServing: 100,
        ingredient: { name: 'Spaghetti', defaultUnit: 'g', measuredByVolume: false },
      },
    ],
    preparationSteps: [],
    ...overrides,
  } as unknown as Recipe
}

/** A stored steps row written for `meal` at `servings`. */
function storedAt(meal: Recipe, servings: number) {
  const { inputHash } = recipeStepsRequest(meal, 'en', servings)
  const steps = { steps: ['A stored step.'], pitfalls: ['Salt the water.'], tip: 'Save a cup.' }
  return [{ inputHash, steps: JSON.stringify(steps) }]
}

const STEPS = ['Boil the water.', 'Cook the spaghetti.', 'Drain it.']

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    subject: { kind: 'step', index: 1 },
    steps: STEPS,
    equipment: ['Large pot'],
    question: 'How long?',
    servings: 4,
    ...overrides,
  }
}

function callPost(body: unknown = validBody()) {
  return POST(
    new Request('http://localhost/api/meals/meal-1/cook-question', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'meal-1' }) },
  )
}

function promptSent(): string {
  return (mockStreamText.mock.calls[0]?.[0] as { prompt: string }).prompt
}

describe('POST /api/meals/[id]/cook-question', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(SESSION as never)
    mockGetMembership.mockResolvedValue(membership() as never)
    mockLoadRecipe.mockResolvedValue(recipe())
    mockLoadPantry.mockResolvedValue([] as never)
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 59,
      limit: 60,
      resetAt: new Date('2026-10-26T12:00:00.000Z'),
    })
    mockAssertUnderCap.mockResolvedValue(undefined)
    mockGetServerFlag.mockResolvedValue(true)
    model.parts = answerParts(['About ', '10 minutes.'])
  })

  it('returns 401 with no session', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await callPost()

    expect(response.status).toBe(401)
    expect((await response.json()).code).toBe('unauthorized')
    expect(mockLoadRecipe).not.toHaveBeenCalled()
  })

  it('returns 404 no_household when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await callPost()

    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('no_household')
  })

  // The loader is scoped to what the household can see, so another
  // household's recipe comes back as `not_found`.
  it('returns 404 meal_not_found when the household has no such recipe', async () => {
    mockLoadRecipe.mockRejectedValue(new RecipeStepsError('not_found'))

    const response = await callPost()

    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('meal_not_found')
    expect(mockLoadRecipe).toHaveBeenCalledWith('household-1', 'meal-1', 'en', 4)
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
    expect(mockStreamText).not.toHaveBeenCalled()
  })

  it.each([
    ['no servings', { servings: undefined }],
    ['servings off the half grid', { servings: 2.3 }],
    ['servings past the control', { servings: 999 }],
    ['an empty question', { question: '  ' }],
    ['a step index past the steps', { subject: { kind: 'step', index: 3 } }],
    ['no steps', { steps: [] }],
  ])('returns 400 invalid_question for %s', async (_name, overrides) => {
    const response = await callPost(validBody(overrides))

    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('invalid_question')
    expect(mockStreamText).not.toHaveBeenCalled()
  })

  it("accepts the household's own servings", async () => {
    const response = await callPost(validBody({ servings: 2.5 }))

    expect(response.status).toBe(200)
    expect(promptSent()).toContain('Servings: 2.5')
  })

  it('returns 429 rate_limited with Retry-After on the cook-question bucket', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      limit: 60,
      resetAt: new Date('2026-10-26T12:00:00.000Z'),
    })

    const response = await callPost()

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('90')
    expect((await response.json()).code).toBe('rate_limited')
    expect(mockCheckRateLimit).toHaveBeenCalledWith('household-1', 'cook-question')
    expect(mockStreamText).not.toHaveBeenCalled()
  })

  it('returns 503 generation_disabled when the kill switch is off', async () => {
    mockGetServerFlag.mockResolvedValue(false)

    const response = await callPost()

    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe('generation_disabled')
  })

  it('returns 429 ai_cap_exceeded when the household is over its AI cap', async () => {
    mockAssertUnderCap.mockRejectedValue(
      new AiCostCapExceededError(new Date('2026-11-01T00:00:00.000Z'), 'Europe/Tallinn'),
    )

    const response = await callPost()

    expect(response.status).toBe(429)
    expect((await response.json()).code).toBe('ai_cap_exceeded')
  })

  it('builds the prompt from the recipe, the servings on screen and the steps on screen', async () => {
    const response = await callPost()

    expect(response.status).toBe(200)
    const prompt = promptSent()
    expect(prompt).toContain('Pasta')
    expect(prompt).toContain('Servings: 4')
    expect(prompt).toContain('Spaghetti')
    expect(prompt).toContain('1. Boil the water.\n2. Cook the spaghetti.\n3. Drain it.')
    expect(prompt).toContain('The cook is on step 2: Cook the spaghetti.')
    // The household's own list is the whole meal (HON-1245).
    expect(prompt).toContain("The household changed this meal's ingredients")
  })

  it('answers about a step of a library meal, unchanged and without notes (HON-1351)', async () => {
    mockLoadRecipe.mockResolvedValue(
      recipe({ id: 'meal-porridge', householdId: null, preparationNotes: 'Stir often.' }),
    )

    const response = await callPost()

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('About 10 minutes.')
    const prompt = promptSent()
    expect(prompt).toContain('The cook is on step 2: Cook the spaghetti.')
    expect(prompt).not.toContain("The household changed this meal's ingredients")
    expect(prompt).not.toContain('Stir often.')
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: 'household-1', feature: 'cook_question' }),
    )
  })

  it('adds the stored Watch out and Tip at these servings, but not the stored steps', async () => {
    mockLoadRecipe.mockResolvedValue(recipe({ preparationSteps: storedAt(recipe(), 4) }))

    await callPost()

    const prompt = promptSent()
    expect(prompt).toContain('Watch out:\n- Salt the water.')
    expect(prompt).toContain('Tip: Save a cup.')
    expect(prompt).not.toContain('A stored step.')
    expect(saveRecipeSteps).not.toHaveBeenCalled()
  })

  it('leaves out the stored Watch out and Tip when they were written at other servings', async () => {
    mockLoadRecipe.mockResolvedValue(recipe({ preparationSteps: storedAt(recipe(), 2) }))

    await callPost()

    expect(promptSent()).not.toContain('Salt the water.')
  })

  it('puts the previous question and answer in the prompt (HON-980)', async () => {
    await callPost(
      validBody({
        question: 'And al dente?',
        previous: { question: 'How long?', answer: 'About 10 minutes.' },
      }),
    )

    const prompt = promptSent()
    expect(prompt).toContain('The cook already asked about this step, and you answered:')
    expect(prompt).toContain('<<<\nHow long?\n>>>')
    expect(prompt).toContain('<<<\nAbout 10 minutes.\n>>>')
    expect(prompt).toContain('<<<\nAnd al dente?\n>>>')
  })

  it('answers about an item in "You\'ll need"', async () => {
    const response = await callPost(validBody({ subject: { kind: 'equipment', index: 0 } }))

    expect(response.status).toBe(200)
    expect(promptSent()).toContain('one piece of equipment')
  })

  it('streams the answer, then records usage and logs the sample', async () => {
    const response = await callPost()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(await response.text()).toBe('About 10 minutes.')
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: 'household-1', feature: 'cook_question' }),
    )
    expect(logAiSample).toHaveBeenCalledWith(
      expect.objectContaining({
        callSite: 'cook-question',
        input: {
          mealName: 'Pasta',
          subject: { kind: 'step', index: 1 },
          source: 'uncached',
          mode: 'recipe',
        },
        output: { answer: 'About 10 minutes.' },
      }),
    )
  })

  it('returns 500 question_failed when the model writes nothing', async () => {
    model.parts = answerParts([])

    const response = await callPost()

    expect(response.status).toBe(500)
    expect((await response.json()).code).toBe('question_failed')
  })
})
