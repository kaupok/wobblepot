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

// Every write the route could make is mocked so the tests can assert it never
// makes one: the answer lives on the cook's screen only.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    mealPlanEntry: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    meal: { update: vi.fn(), updateMany: vi.fn() },
    pantryItem: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}))

// The real `streamText` runs against a mock model, so the tests read the
// stream parts and the usage the SDK really produces (HON-979).
const model = vi.hoisted(() => ({ parts: [] as unknown[], modelIds: [] as string[] }))

vi.mock('@ai-sdk/anthropic', async () => {
  const { MockLanguageModelV4 } = await import('ai/test')
  return {
    createAnthropic: vi.fn(() => (modelName: string) => {
      model.modelIds.push(modelName)
      return new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream({
            start(controller) {
              // Loosely typed parts, as each test writes them.
              for (const part of model.parts) controller.enqueue(part as never)
              controller.close()
            },
          }),
        }),
      })
    }),
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

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

/** `USAGE_FIXTURE` as the provider reports it, before the SDK maps it. */
const PROVIDER_USAGE = {
  inputTokens: { total: 1531, noCache: 1031, cacheRead: 500, cacheWrite: 0 },
  outputTokens: { total: 787, text: undefined, reasoning: undefined },
}

const STOP = { unified: 'stop', raw: 'end_turn' }

/** The model's stream: the answer in `chunks`, then a finish with the usage. */
function answerParts(chunks: string[], finishReason: Record<string, string> = STOP) {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't1' },
    ...chunks.map((delta) => ({ type: 'text-delta', id: 't1', delta })),
    { type: 'text-end', id: 't1' },
    { type: 'finish', finishReason, usage: PROVIDER_USAGE },
  ]
}

/** Read the whole body as the hook does: chunk by chunk. */
async function readChunks(response: Response): Promise<string[]> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return chunks
    chunks.push(decoder.decode(value, { stream: true }))
  }
}

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { streamText } from 'ai'
import { checkRateLimit } from '@/lib/rate-limit'
import { AiCostCapExceededError, assertUnderCap, recordAiUsage } from '@/lib/ai/usage'
import { logAiSample } from '@/lib/ai/sampling'
import { getServerFlag } from '@/lib/feature-flags'
import { COOK_QUESTION_MODEL } from '@/lib/ai/models'
import { expectedUsageStats } from '@/lib/ai/usage-fixture'
import { captureApiError } from '@/lib/errors'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockEntryFindFirst = vi.mocked(prisma.mealPlanEntry.findFirst)
const mockPantryFindMany = vi.mocked(prisma.pantryItem.findMany)
const mockStreamText = vi.mocked(streamText)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockAssertUnderCap = vi.mocked(assertUnderCap)
const mockRecordAiUsage = vi.mocked(recordAiUsage)
const mockLogAiSample = vi.mocked(logAiSample)
const mockGetServerFlag = vi.mocked(getServerFlag)
const mockCaptureApiError = vi.mocked(captureApiError)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
}

function buildMembership(preferences: Record<string, unknown> | null = null) {
  return {
    id: 'member-123',
    householdId: 'household-123',
    userId: 'user-123',
    role: 'owner',
    household: {
      id: 'household-123',
      name: 'Test Household',
      timezone: 'Europe/Tallinn',
      locale: 'en',
      preferences,
      _count: { members: 4 },
    },
  }
}

function sampleEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    planId: 'plan-1',
    mealId: 'meal-1',
    preparationTips: null,
    servingOverride: null,
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

const STEPS = ['Slice the chicken.', 'Fry the chicken.', 'Add the sauce.']

function validBody(overrides: Record<string, unknown> = {}) {
  return { stepIndex: 1, steps: STEPS, question: "How do I know it's done?", ...overrides }
}

function callPost(body: unknown = validBody()) {
  return POST(
    new Request('http://localhost/api/meal-plans/plan-1/entries/entry-1/cook-question', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'plan-1', entryId: 'entry-1' }) },
  )
}

function promptSent(): string {
  return (mockStreamText.mock.calls[0]?.[0] as { prompt: string }).prompt
}

function expectNoWrites() {
  expect(prisma.mealPlanEntry.update).not.toHaveBeenCalled()
  expect(prisma.mealPlanEntry.updateMany).not.toHaveBeenCalled()
  expect(prisma.meal.update).not.toHaveBeenCalled()
  expect(prisma.meal.updateMany).not.toHaveBeenCalled()
  expect(prisma.pantryItem.update).not.toHaveBeenCalled()
  expect(prisma.pantryItem.updateMany).not.toHaveBeenCalled()
  expect(prisma.pantryItem.upsert).not.toHaveBeenCalled()
}

describe('POST /api/meal-plans/[id]/entries/[entryId]/cook-question', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(buildMembership() as never)
    mockEntryFindFirst.mockResolvedValue(sampleEntry() as never)
    mockPantryFindMany.mockResolvedValue([] as never)
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 59,
      limit: 60,
      resetAt: new Date('2026-02-01T12:00:00.000Z'),
    })
    mockAssertUnderCap.mockResolvedValue(undefined)
    mockGetServerFlag.mockResolvedValue(true)
    model.parts = answerParts(['Cut into the thickest ', 'piece: no pink.'])
    model.modelIds = []
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await callPost()

    expect(response.status).toBe(401)
    expect((await response.json()).code).toBe('unauthorized')
  })

  it('returns 404 when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await callPost()

    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('no_household')
  })

  describe('invalid_question', () => {
    it.each([
      ['an empty question', validBody({ question: '' })],
      ['a whitespace-only question', validBody({ question: '   ' })],
      ['a 301-character question', validBody({ question: 'a'.repeat(301) })],
      ['13 steps', validBody({ steps: Array.from({ length: 13 }, (_, i) => `Step ${i + 1}`) })],
      ['no steps', validBody({ steps: [], stepIndex: 0 })],
      ['a 501-character step', validBody({ steps: ['a'.repeat(501)], stepIndex: 0 })],
      ['a step index past the steps', validBody({ stepIndex: 3 })],
      ['a negative step index', validBody({ stepIndex: -1 })],
      ['a fractional step index', validBody({ stepIndex: 1.5 })],
      ['a body that is not an object', 'hello'],
    ])('returns 400 for %s', async (_name, body) => {
      const response = await callPost(body)

      expect(response.status).toBe(400)
      expect((await response.json()).code).toBe('invalid_question')
      expect(mockCheckRateLimit).not.toHaveBeenCalled()
      expect(mockStreamText).not.toHaveBeenCalled()
    })

    it('accepts a 300-character question and 12 steps', async () => {
      const steps = Array.from({ length: 12 }, (_, i) => `Step ${i + 1}`)
      const response = await callPost({ stepIndex: 11, steps, question: 'a'.repeat(300) })

      expect(response.status).toBe(200)
    })
  })

  describe('the previous question and answer (HON-980)', () => {
    const previous = { question: 'What can I substitute here?', answer: 'Use the yoghurt.' }

    it('puts a valid previous question and answer in the prompt, trimmed', async () => {
      const response = await callPost(
        validBody({
          question: 'And if I have no oil?',
          previous: { question: `  ${previous.question} `, answer: ` ${previous.answer}\n` },
        }),
      )

      expect(response.status).toBe(200)
      const prompt = promptSent()
      expect(prompt).toContain('The cook already asked about this step, and you answered:')
      expect(prompt).toContain('<<<\nWhat can I substitute here?\n>>>')
      expect(prompt).toContain('<<<\nUse the yoghurt.\n>>>')
      expect(prompt).toContain('<<<\nAnd if I have no oil?\n>>>')
    })

    it('accepts a 1200-character answer', async () => {
      const answer = 'a'.repeat(1200)
      const response = await callPost(validBody({ previous: { ...previous, answer } }))

      expect(response.status).toBe(200)
      expect(promptSent()).toContain(`<<<\n${answer}\n>>>`)
    })

    it.each([
      ['a 1201-character answer', { ...previous, answer: 'a'.repeat(1201) }],
      ['a 301-character question', { ...previous, question: 'a'.repeat(301) }],
      ['an empty answer', { ...previous, answer: '  ' }],
      ['a missing answer', { question: previous.question }],
      ['a number for the answer', { ...previous, answer: 42 }],
      ['a string instead of an object', 'What can I substitute here?'],
      ['null', null],
    ])('drops %s and still answers the question', async (_name, bad) => {
      const response = await callPost(validBody({ previous: bad }))

      expect(response.status).toBe(200)
      expect(promptSent()).not.toContain('already asked about this step')
      expect(promptSent()).toContain("<<<\nHow do I know it's done?\n>>>")
    })
  })

  it('scopes the entry lookup to the household and returns 404 when not found', async () => {
    mockEntryFindFirst.mockResolvedValue(null)

    const response = await callPost()

    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('entry_not_found')
    expect(mockEntryFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'entry-1', planId: 'plan-1', plan: { householdId: 'household-123' } },
      }),
    )
  })

  it('returns 400 no_meal when the entry has no meal', async () => {
    mockEntryFindFirst.mockResolvedValue(sampleEntry({ meal: null, mealId: null }) as never)

    const response = await callPost()

    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('no_meal')
  })

  it('returns 429 rate_limited with Retry-After on the cook-question bucket', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      limit: 60,
      resetAt: new Date('2026-02-01T12:00:00.000Z'),
    })

    const response = await callPost()

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('90')
    expect((await response.json()).code).toBe('rate_limited')
    expect(mockCheckRateLimit).toHaveBeenCalledWith('household-123', 'cook-question')
    expect(mockStreamText).not.toHaveBeenCalled()
  })

  it('returns 503 generation_disabled when the kill switch is off', async () => {
    mockGetServerFlag.mockResolvedValue(false)

    const response = await callPost()

    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe('generation_disabled')
    expect(mockGetServerFlag).toHaveBeenCalledWith('ai_generation_enabled', 'user-123')
    expect(mockAssertUnderCap).not.toHaveBeenCalled()
    expect(mockStreamText).not.toHaveBeenCalled()
  })

  it('returns 429 ai_cap_exceeded when the household is over its AI cap', async () => {
    mockAssertUnderCap.mockRejectedValue(
      new AiCostCapExceededError(new Date('2026-03-01T00:00:00.000Z'), 'Europe/Tallinn'),
    )

    const response = await callPost()

    expect(response.status).toBe(429)
    expect((await response.json()).code).toBe('ai_cap_exceeded')
    expect(mockStreamText).not.toHaveBeenCalled()
  })

  it('answers an entry whose tips were served uncached, without pitfalls', async () => {
    const response = await callPost()

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Cut into the thickest piece: no pink.')
    const prompt = promptSent()
    expect(prompt).toContain('2. Fry the chicken.')
    expect(prompt).toContain('The cook is on step 2: Fry the chicken.')
    expect(prompt).not.toContain('Watch out:')
    expectNoWrites()
  })

  it('adds the cached pitfalls and tip, but answers about the steps the request sent', async () => {
    mockEntryFindFirst.mockResolvedValue(
      sampleEntry({
        preparationTips: JSON.stringify({
          steps: ['A cached step'],
          pitfalls: ['Do not crowd the pan'],
          tip: 'Rest the meat',
        }),
      }) as never,
    )

    await callPost()

    const prompt = promptSent()
    expect(prompt).toContain('Watch out:\n- Do not crowd the pan')
    expect(prompt).toContain('Tip: Rest the meat')
    expect(prompt).not.toContain('A cached step')
    expectNoWrites()
  })

  it('builds the prompt from the pantry and the household restrictions', async () => {
    mockGetMembership.mockResolvedValue(
      buildMembership({
        allergensToAvoid: ['tree_nuts'],
        dietaryType: null,
        excludedIngredients: [],
        restrictions: ['mild spice only'],
      }) as never,
    )
    mockPantryFindMany.mockResolvedValue([
      { isStaple: false, ingredient: { name: 'greek yoghurt' } },
      { isStaple: true, ingredient: { name: 'salt' } },
    ] as never)

    await callPost()

    const prompt = promptSent()
    expect(prompt).toContain('- greek yoghurt\n')
    expect(prompt).toContain('- salt (staple)')
    expect(prompt).toContain('MUST AVOID these allergens (safety-critical): tree_nuts')
    expect(prompt).toContain('Household restrictions (follow them): mild spice only')
    expect(mockPantryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          householdId: 'household-123',
          OR: [{ isStaple: true }, { quantity: null }, { quantity: { gt: 0 } }],
        },
      }),
    )
    expectNoWrites()
  })

  it('streams the answer as plain text, chunk by chunk', async () => {
    model.parts = answerParts(['Cut into ', 'the thickest ', 'piece.'])

    const response = await callPost()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(await readChunks(response)).toEqual(['Cut into ', 'the thickest ', 'piece.'])
  })

  it('records usage once with the finished numbers, and logs the full text', async () => {
    const response = await callPost()
    await response.text()

    expect(model.modelIds).toEqual([COOK_QUESTION_MODEL])
    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: 600, maxRetries: 3 }),
    )
    expect(mockRecordAiUsage).toHaveBeenCalledOnce()
    expect(mockRecordAiUsage).toHaveBeenCalledWith({
      householdId: 'household-123',
      feature: 'cook_question',
      ...expectedUsageStats(COOK_QUESTION_MODEL),
    })
    expect(mockLogAiSample).toHaveBeenCalledWith(
      expect.objectContaining({
        callSite: 'cook-question',
        input: { mealName: 'Chicken stir fry', stepIndex: 1, source: 'uncached' },
        output: { answer: 'Cut into the thickest piece: no pink.' },
      }),
    )
  })

  it('closes the stream only once the usage is recorded', async () => {
    let finishWrite: () => void = () => {}
    mockRecordAiUsage.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve
        }),
    )
    const response = await callPost()
    const reader = response.body!.getReader()
    await reader.read()
    await reader.read()

    let closed = false
    const end = reader.read().then((result) => {
      closed = result.done
    })
    await vi.waitFor(() => expect(mockRecordAiUsage).toHaveBeenCalledOnce())
    expect(closed).toBe(false)

    finishWrite()
    await end
    expect(closed).toBe(true)
  })

  it('a model that writes nothing records a failed call and answers 500', async () => {
    model.parts = answerParts([])

    const response = await callPost()

    expect(response.status).toBe(500)
    expect((await response.json()).code).toBe('question_failed')
    expect(mockRecordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ ...expectedUsageStats(COOK_QUESTION_MODEL), success: false }),
    )
  })

  it('ends an answer cut off at the token ceiling in an error, billed as a failed call', async () => {
    model.parts = answerParts(['Pierce the thickest part; ', 'the juices should run'], {
      unified: 'length',
      raw: 'max_tokens',
    })

    const response = await callPost()

    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toBe('Pierce the thickest part; ')
    expect(decoder.decode((await reader.read()).value)).toBe('the juices should run')
    await expect(reader.read()).rejects.toThrow('cut off')
    expect(mockRecordAiUsage).toHaveBeenCalledOnce()
    expect(mockRecordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ ...expectedUsageStats(COOK_QUESTION_MODEL), success: false }),
    )
    expect(mockLogAiSample).not.toHaveBeenCalled()
  })

  describe('a failure after the first words', () => {
    beforeEach(() => {
      model.parts = [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Cut into ' },
        { type: 'error', error: Object.assign(new Error('overloaded'), { statusCode: 529 }) },
      ]
    })

    it('sends what arrived, then ends the stream in an error', async () => {
      const response = await callPost()

      expect(response.status).toBe(200)
      const reader = response.body!.getReader()
      const first = await reader.read()
      expect(new TextDecoder().decode(first.value)).toBe('Cut into ')
      await expect(reader.read()).rejects.toThrow('overloaded')
    })

    it('records one failed call, captures the error and logs no sample', async () => {
      const response = await callPost()
      await response.text().catch(() => {})

      expect(mockRecordAiUsage).toHaveBeenCalledOnce()
      expect(mockRecordAiUsage).toHaveBeenCalledWith(
        expect.objectContaining({ feature: 'cook_question', success: false }),
      )
      expect(mockCaptureApiError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'overloaded' }),
        expect.objectContaining({ feature: 'cook_question' }),
      )
      expect(mockLogAiSample).not.toHaveBeenCalled()
    })
  })

  describe('AI failures', () => {
    it.each([
      [Object.assign(new Error('busy'), { statusCode: 429 }), 429, 'provider_busy'],
      [Object.assign(new Error('overloaded'), { statusCode: 529 }), 502, 'provider_unavailable'],
      [Object.assign(new Error('Timeout'), { name: 'TimeoutError' }), 504, 'question_timeout'],
      [new Error('boom'), 500, 'question_failed'],
    ])('maps %s before the first word to %i %s', async (error, status, code) => {
      model.parts = [
        { type: 'stream-start', warnings: [] },
        { type: 'error', error },
      ]

      const response = await callPost()

      expect(response.status).toBe(status)
      expect((await response.json()).code).toBe(code)
      // A provider error before any text bills nothing, as before streaming.
      expect(mockRecordAiUsage).not.toHaveBeenCalled()
    })
  })
})
