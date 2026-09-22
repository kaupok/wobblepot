// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Never call the real APIs (HON-735): the image and judge SDK calls and
// `@vercel/blob` are mocked, and the real `generateMealImage` runs on top.

const env = vi.hoisted(() => ({
  OPENAI_API_KEY: 'sk-test' as string | undefined,
  ANTHROPIC_API_KEY: 'sk-ant-test',
}))

/**
 * One in-memory `meal` row. `updateMany` evaluates the `where` the route
 * builds, so the claim and the guarded writes are tested against real
 * predicate logic rather than scripted counts.
 */
const db = vi.hoisted(() => {
  type Row = Record<string, unknown>
  const state: { row: Row | null } = { row: null }

  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, expected]) => {
      if (key === 'OR') return (expected as Row[]).some((w) => matches(row, w))
      const actual = row[key]
      if (expected instanceof Date) {
        return actual instanceof Date && actual.getTime() === expected.getTime()
      }
      if (expected !== null && typeof expected === 'object' && 'lt' in expected) {
        const lt = (expected as { lt: Date | number }).lt
        if (actual === null || actual === undefined) return false
        return lt instanceof Date ? (actual as Date) < lt : (actual as number) < lt
      }
      return actual === expected
    })

  const apply = (row: Row, data: Row, bumpUpdatedAt: boolean) => {
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && typeof value === 'object' && 'increment' in value) {
        row[key] = (row[key] as number) + (value as { increment: number }).increment
      } else {
        row[key] = value
      }
    }
    // Prisma's `@updatedAt`: set on every write unless the data sets it.
    if (bumpUpdatedAt && !('updatedAt' in data)) row.updatedAt = new Date(Date.now() + 1)
  }

  return { state, matches, apply }
})

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/env', () => ({ serverEnv: env }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    meal: {
      findFirst: vi.fn(async () => (db.state.row ? { ...db.state.row } : null)),
      updateMany: vi.fn(async ({ where, data }) => {
        const row = db.state.row
        if (!row || !db.matches(row, where)) return { count: 0 }
        db.apply(row, data, true)
        return { count: 1 }
      }),
    },
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  retryAfterSeconds: vi.fn(() => 60),
}))

vi.mock('@/lib/ai/usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/usage')>()),
  assertUnderCap: vi.fn(),
  recordAiUsage: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateImage: vi.fn(),
  generateObject: vi.fn(),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({ image: (id: string) => ({ imageModelId: id }) })),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => (id: string) => ({ languageModelId: id })),
}))

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  del: vi.fn(),
}))

// The mocked image bytes are not a real PNG; `colour.test.ts` covers the extraction.
vi.mock('@/lib/meal-images/colour', () => ({
  extractHue: vi.fn(),
}))

import { APICallError, generateImage, generateObject, RetryError } from 'ai'
import { del, put } from '@vercel/blob'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'
import { AiCostCapExceededError, assertUnderCap, recordAiUsage } from '@/lib/ai/usage'
import { clearMealImage } from '@/lib/meal-images/invalidation'
import { extractHue } from '@/lib/meal-images/colour'
import { captureApiError } from '@/lib/errors'
import type { Prisma } from '@/generated/prisma/client'
import { GET, POST } from './route'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockAssertUnderCap = vi.mocked(assertUnderCap)
const mockRecordAiUsage = vi.mocked(recordAiUsage)
const mockGenerateImage = vi.mocked(generateImage)
const mockGenerateObject = vi.mocked(generateObject)
const mockPut = vi.mocked(put)
const mockDel = vi.mocked(del)
const mockExtractHue = vi.mocked(extractHue)
const hue = (value: number | null) => ({
  hue: value,
  chroma: 0.2,
  coverage: 0.3,
  opaque: 1,
  bins: [],
})

const HOUSEHOLD_ID = 'household-123'
const BLOB_URL = 'https://store.public.blob.vercel-storage.com/meals/meal-1-abc.png'
const EDITED_AT = new Date('2026-09-20T10:00:00Z')

const session = {
  user: { id: 'user-123', name: 'Jo', email: 'jo@example.com' },
  session: { id: 'session-123' },
}

const membership = {
  household: { id: HOUSEHOLD_ID, timezone: 'Europe/Tallinn', locale: 'en', _count: { members: 2 } },
}

function seedMeal(over: Record<string, unknown> = {}) {
  db.state.row = {
    id: 'meal-1',
    name: 'Pita with hummus',
    description: 'Warm pita and hummus',
    preparationNotes: null,
    householdId: HOUSEHOLD_ID,
    deletedAt: null,
    updatedAt: EDITED_AT,
    imageUrl: null,
    imageStatus: 'none',
    imageClaimedAt: null,
    imageAttempts: 0,
    imagePromptVersion: null,
    imageHue: null,
    components: [
      {
        quantityPerServing: 3,
        ingredient: { name: 'cumin', defaultUnit: 'g', gramsPerPiece: null, densityGPerMl: null },
      },
      {
        quantityPerServing: 1,
        ingredient: { name: 'pita', defaultUnit: 'piece', gramsPerPiece: 60, densityGPerMl: null },
      },
    ],
    ...over,
  }
  return db.state.row
}

const row = () => db.state.row!

const cleanJudge = {
  object: {
    extraIngredients: [],
    propsOrCookware: [],
    missingIngredients: [],
    portion: 'one-serving',
  },
  usage: {
    inputTokens: 2_000,
    outputTokens: 500,
    inputTokenDetails: { noCacheTokens: 2_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
  },
} as never

const imageResult = {
  image: { uint8Array: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
  usage: { inputTokens: 110, outputTokens: 1_372, totalTokens: 1_482 },
} as never

const post = () =>
  POST(new Request('http://localhost/api/meals/meal-1/image', { method: 'POST' }), {
    params: Promise.resolve({ id: 'meal-1' }),
  })

describe('POST /api/meals/[id]/image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    env.OPENAI_API_KEY = 'sk-test'
    seedMeal()
    mockGetSession.mockResolvedValue(session as never)
    mockGetMembership.mockResolvedValue(membership as never)
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      limit: 30,
      remaining: 29,
      resetAt: new Date(),
    })
    mockAssertUnderCap.mockResolvedValue(undefined)
    mockGenerateImage.mockResolvedValue(imageResult)
    mockGenerateObject.mockResolvedValue(cleanJudge)
    mockPut.mockResolvedValue({ url: BLOB_URL } as never)
    mockDel.mockResolvedValue(undefined)
    mockExtractHue.mockResolvedValue(hue(264))
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
  })

  it('returns 404 for a meal the household cannot see', async () => {
    db.state.row = null
    expect((await post()).status).toBe(404)
  })

  it('returns a ready image without generating or spending a rate-limit token', async () => {
    seedMeal({ imageStatus: 'ready', imageUrl: BLOB_URL, imageHue: 120 })

    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready', imageUrl: BLOB_URL, imageHue: 120 })
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
    expect(mockGenerateImage).not.toHaveBeenCalled()
  })

  it('generates, uploads and stores the image with its prompt version and hue', async () => {
    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready', imageUrl: BLOB_URL, imageHue: 264 })
    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
    expect(mockPut).toHaveBeenCalledWith('meals/meal-1.png', expect.any(Buffer), expect.anything())
    expect(mockExtractHue).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]))
    expect(row()).toMatchObject({
      imageStatus: 'ready',
      imageUrl: BLOB_URL,
      imagePromptVersion: 'v4',
      imageHue: 264,
    })
    expect(mockCheckRateLimit).toHaveBeenCalledWith(HOUSEHOLD_ID, 'meal-image')
  })

  it('draws the ingredients by weight, so a piece of pita outranks 3 g of cumin', async () => {
    await post()

    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('largest amount first: pita, cumin.'),
      }),
    )
  })

  it('leaves Meal.updatedAt alone, so the prep-tips cache guard still matches', async () => {
    await post()

    expect(row().updatedAt).toEqual(EDITED_AT)
  })

  it('records the image and the judge spend as meal_image rows', async () => {
    await post()

    expect(mockRecordAiUsage).toHaveBeenCalledTimes(2)
    expect(mockRecordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: HOUSEHOLD_ID,
        feature: 'meal_image',
        model: 'gpt-image-2.5-flare',
        outputTokens: 1_372,
      }),
    )
    expect(mockRecordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: HOUSEHOLD_ID,
        feature: 'meal_image',
        model: 'claude-sonnet-5',
      }),
    )
  })

  it('makes exactly one generateImage call for two concurrent requests', async () => {
    const [a, b] = await Promise.all([post(), post()])

    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
    expect([a.status, b.status].sort()).toEqual([200, 202])
    const loser = a.status === 202 ? a : b
    expect(await loser.json()).toEqual({ status: 'generating' })
  })

  it('answers 202 to a poll on a fresh claim without spending a rate-limit token', async () => {
    seedMeal({ imageStatus: 'generating', imageClaimedAt: new Date(Date.now() - 60_000) })

    const response = await post()

    expect(response.status).toBe(202)
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
    expect(mockGenerateImage).not.toHaveBeenCalled()
  })

  it('reclaims a claim older than 3 minutes', async () => {
    seedMeal({ imageStatus: 'generating', imageClaimedAt: new Date(Date.now() - 3 * 60_000 - 1) })

    const response = await post()

    expect(response.status).toBe(200)
    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
    expect(row().imageStatus).toBe('ready')
  })

  it('retries a failed image with attempts left', async () => {
    seedMeal({ imageStatus: 'failed', imageAttempts: 2 })

    expect((await post()).status).toBe(200)
    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
  })

  it('never retries a meal whose image failed 3 times', async () => {
    seedMeal({ imageStatus: 'failed', imageAttempts: 3 })

    const response = await post()

    expect(await response.json()).toEqual({ status: 'failed' })
    expect(mockGenerateImage).not.toHaveBeenCalled()
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })

  it('never generates a global meal', async () => {
    seedMeal({ householdId: null })

    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'none' })
    expect(mockGenerateImage).not.toHaveBeenCalled()
    expect(mockAssertUnderCap).not.toHaveBeenCalled()
  })

  it('answers 202 for a global meal the batch is generating, without claiming it', async () => {
    seedMeal({ householdId: null, imageStatus: 'generating', imageClaimedAt: new Date(0) })

    const response = await post()

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'generating' })
    expect(mockGenerateImage).not.toHaveBeenCalled()
  })

  it('serves a global meal image the batch already made', async () => {
    seedMeal({ householdId: null, imageStatus: 'ready', imageUrl: BLOB_URL })

    expect(await (await post()).json()).toEqual({
      status: 'ready',
      imageUrl: BLOB_URL,
      imageHue: null,
    })
  })

  it('discards the image when the meal is edited mid-generation', async () => {
    mockGenerateImage.mockImplementation(async () => {
      // The meal PATCH commits while the image is being drawn (HON-734).
      await clearMealImage(
        {
          meal: {
            findUniqueOrThrow: async () => ({ imageUrl: row().imageUrl }),
            update: async ({ data }: { data: Record<string, unknown> }) =>
              db.apply(row(), data, true),
          },
        } as unknown as Prisma.TransactionClient,
        'meal-1',
      )
      return imageResult
    })

    const response = await post()

    expect(await response.json()).toEqual({ status: 'none' })
    expect(row()).toMatchObject({ imageStatus: 'none', imageUrl: null })
    expect(mockPut).toHaveBeenCalledTimes(1)
    expect(mockDel).toHaveBeenCalledWith(BLOB_URL)
  })

  it('still attaches the image when an unrelated edit moved updatedAt mid-generation', async () => {
    mockGenerateImage.mockImplementation(async () => {
      // A servings-only edit: no clearMealImage, but @updatedAt moves.
      row().updatedAt = new Date('2026-09-21T10:00:00Z')
      return imageResult
    })

    const response = await post()

    expect(await response.json()).toEqual({ status: 'ready', imageUrl: BLOB_URL, imageHue: 264 })
    expect(mockDel).not.toHaveBeenCalled()
  })

  it('stores a null hue and still returns ready when extraction fails', async () => {
    mockExtractHue.mockRejectedValueOnce(new Error('unsupported image format'))

    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready', imageUrl: BLOB_URL, imageHue: null })
    expect(row()).toMatchObject({ imageStatus: 'ready', imageUrl: BLOB_URL, imageHue: null })
    expect(mockDel).not.toHaveBeenCalled()
    expect(captureApiError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ operation: 'meal-image-hue', mealId: 'meal-1' }),
    )
  })

  it('stores a null hue when the image carries no colour', async () => {
    mockExtractHue.mockResolvedValueOnce(hue(null))

    await post()

    expect(row()).toMatchObject({ imageStatus: 'ready', imageHue: null })
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it('marks the image failed and counts the attempt when generation fails', async () => {
    mockGenerateImage.mockRejectedValue(new Error('boom'))

    const response = await post()

    expect(response.status).toBe(500)
    expect(row()).toMatchObject({ imageStatus: 'failed', imageAttempts: 1 })
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('does not count a provider 429 against the meal, even after the SDK retried it', async () => {
    seedMeal({ imageStatus: 'failed', imageAttempts: 2 })
    const busy = new APICallError({
      message: 'busy',
      url: 'https://api.openai.com/v1/images/generations',
      requestBodyValues: {},
      statusCode: 429,
      isRetryable: true,
    })
    // What `generateImage` with `maxRetries: 1` actually throws.
    mockGenerateImage.mockRejectedValue(
      new RetryError({ message: 'failed', reason: 'maxRetriesExceeded', errors: [busy, busy] }),
    )

    const response = await post()

    expect(response.status).toBe(429)
    expect(row()).toMatchObject({ imageStatus: 'failed', imageAttempts: 2 })
  })

  it('deletes the uploaded blob when the final write throws', async () => {
    const { prisma } = await import('@/lib/prisma')
    const updateMany = vi.mocked(prisma.meal.updateMany)
    const real = updateMany.getMockImplementation()!
    updateMany
      .mockImplementationOnce(real) // claim
      .mockRejectedValueOnce(new Error('db down')) // finalize

    const response = await post()

    expect(response.status).toBe(500)
    expect(mockDel).toHaveBeenCalledWith(BLOB_URL)
  })

  it('answers 504 when the AI budget runs out', async () => {
    mockGenerateImage.mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }))

    const response = await post()

    expect(response.status).toBe(504)
    expect(row().imageStatus).toBe('failed')
  })

  it('answers 503 without an OpenAI key, and generates nothing', async () => {
    env.OPENAI_API_KEY = undefined

    const response = await post()

    expect(response.status).toBe(503)
    expect(mockGenerateImage).not.toHaveBeenCalled()
    expect(row().imageStatus).toBe('none')
  })

  it('returns the shared cap error shape over the cap, and generates nothing', async () => {
    mockAssertUnderCap.mockRejectedValue(
      new AiCostCapExceededError(new Date(Date.now() + 86_400_000), 'Europe/Tallinn'),
    )

    const response = await post()

    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({
      error: 'AI usage cap exceeded',
      code: 'ai_cap_exceeded',
    })
    expect(mockGenerateImage).not.toHaveBeenCalled()
    expect(row().imageStatus).toBe('none')
  })

  it('returns 429 when rate-limited, before claiming', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      limit: 30,
      remaining: 0,
      resetAt: new Date(),
    })

    const response = await post()

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(row().imageStatus).toBe('none')
  })
})

describe('GET /api/meals/[id]/image', () => {
  const get = () =>
    GET(new Request('http://localhost/api/meals/meal-1/image'), {
      params: Promise.resolve({ id: 'meal-1' }),
    })

  beforeEach(() => {
    vi.clearAllMocks()
    env.OPENAI_API_KEY = 'sk-test'
    seedMeal()
    mockGetSession.mockResolvedValue(session as never)
    mockGetMembership.mockResolvedValue(membership as never)
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
  })

  it('returns 404 for a meal the household cannot see', async () => {
    db.state.row = null
    expect((await get()).status).toBe(404)
  })

  it('returns a ready image with its hue', async () => {
    seedMeal({ imageStatus: 'ready', imageUrl: BLOB_URL, imageHue: 40 })

    const response = await get()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready', imageUrl: BLOB_URL, imageHue: 40 })
  })

  it('returns the { error } shape when the read fails', async () => {
    vi.mocked(prisma.meal.findFirst).mockRejectedValueOnce(new Error('db down'))

    const response = await get()

    expect(response.status).toBe(500)
    expect(await response.json()).toHaveProperty('error')
  })

  it.each(['none', 'generating', 'failed'] as const)(
    'returns the stored %s status without claiming or generating',
    async (imageStatus) => {
      seedMeal({ imageStatus, imageClaimedAt: null })

      const response = await get()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: imageStatus })
      expect(row().imageStatus).toBe(imageStatus)
      expect(mockGenerateImage).not.toHaveBeenCalled()
      expect(mockCheckRateLimit).not.toHaveBeenCalled()
    },
  )
})
