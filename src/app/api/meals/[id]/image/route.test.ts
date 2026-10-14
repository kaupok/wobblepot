// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Every query, the claim and the guarded writes live in
// `@/lib/meal-images/persist`, tested against a database in
// `persist.db.test.ts`. This file mocks that module at the seam and asserts
// what the route owns: the session, the household, flags, rate limits, the AI
// cap, generation, storage, and the status and body each answer maps to
// (HON-1211).
//
// Never call the real APIs (HON-735): the image and judge SDK calls and
// `@vercel/blob` are mocked, and the real `generateMealImage` runs on top.

const env = vi.hoisted(() => ({
  OPENAI_API_KEY: 'sk-test' as string | undefined,
  ANTHROPIC_API_KEY: 'sk-ant-test',
}))

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

vi.mock('@/lib/meal-images/persist', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-images/persist')>()),
  loadMealForImage: vi.fn(),
  readMealImage: vi.fn(),
  claimMealImage: vi.fn(),
  attachMealImage: vi.fn(),
  releaseMealImageClaim: vi.fn(),
  markMealImageFailed: vi.fn(),
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

vi.mock('@/lib/feature-flags', () => ({
  getServerFlag: vi.fn(),
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
import { checkRateLimit } from '@/lib/rate-limit'
import { AiCostCapExceededError, assertUnderCap, recordAiUsage } from '@/lib/ai/usage'
import {
  attachMealImage,
  claimMealImage,
  loadMealForImage,
  markMealImageFailed,
  readMealImage,
  releaseMealImageClaim,
  type ImageClaim,
  type MealForImage,
} from '@/lib/meal-images/persist'
import { extractHue } from '@/lib/meal-images/colour'
import { vesselSchema } from '@/lib/meal-images/vessel'
import { captureApiError } from '@/lib/errors'
import { getServerFlag } from '@/lib/feature-flags'
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
const mockGetServerFlag = vi.mocked(getServerFlag)
const mockLoadMeal = vi.mocked(loadMealForImage)
const mockReadImage = vi.mocked(readMealImage)
const mockClaim = vi.mocked(claimMealImage)
const mockAttach = vi.mocked(attachMealImage)
const mockRelease = vi.mocked(releaseMealImageClaim)
const mockMarkFailed = vi.mocked(markMealImageFailed)

const hue = (value: number | null) => ({
  hue: value,
  chroma: 0.2,
  coverage: 0.3,
  opaque: 1,
  bins: [],
})

const HOUSEHOLD_ID = 'household-123'
const BLOB_URL = 'https://store.public.blob.vercel-storage.com/meals/meal-1-abc.png'
const OLD_BLOB_URL = 'https://store.public.blob.vercel-storage.com/meals/meal-1-old.png'
const EDITED_AT = new Date('2026-09-20T10:00:00Z')

const session = {
  user: { id: 'user-123', name: 'Jo', email: 'jo@example.com' },
  session: { id: 'session-123' },
}

const membership = {
  household: { id: HOUSEHOLD_ID, timezone: 'Europe/Tallinn', locale: 'en', _count: { members: 2 } },
}

/** The meal `loadMealForImage` answers with: a household meal with no image. */
function seedMeal(over: Partial<MealForImage> = {}): MealForImage {
  const meal: MealForImage = {
    id: 'meal-1',
    name: 'Pita with hummus',
    description: 'Warm pita and hummus',
    preparationNotes: null,
    householdId: HOUSEHOLD_ID,
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
  mockLoadMeal.mockResolvedValue(meal)
  return meal
}

/** The claim `claimMealImage` grants for a meal read at `EDITED_AT`. */
const claimFor = (redraw: boolean): ImageClaim => ({
  mealId: 'meal-1',
  claimedAt: new Date(),
  updatedAt: EDITED_AT,
  redraw,
})

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
    mockClaim.mockImplementation(async (meal) => claimFor(meal.imageStatus === 'ready'))
    mockAttach.mockResolvedValue(true)
    mockRelease.mockResolvedValue(true)
    mockMarkFailed.mockResolvedValue(true)
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
    mockGetServerFlag.mockResolvedValue(true)
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
    mockLoadMeal.mockResolvedValue(null)

    const response = await post()

    expect(response.status).toBe(404)
    expect(mockLoadMeal).toHaveBeenCalledWith(HOUSEHOLD_ID, 'meal-1')
  })

  it('returns a ready image without generating or spending a rate-limit token', async () => {
    seedMeal({ imageStatus: 'ready', imageUrl: BLOB_URL, imageHue: 120, imagePromptVersion: 'v4' })

    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready', imageUrl: BLOB_URL, imageHue: 120 })
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
    expect(mockClaim).not.toHaveBeenCalled()
    expect(mockGenerateImage).not.toHaveBeenCalled()
  })

  it('claims, generates, uploads and attaches the image with its hue', async () => {
    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready', imageUrl: BLOB_URL, imageHue: 264 })
    expect(mockCheckRateLimit).toHaveBeenCalledWith(HOUSEHOLD_ID, 'meal-image')
    expect(mockClaim).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'meal-1', updatedAt: EDITED_AT }),
      expect.any(Date),
    )
    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
    expect(mockPut).toHaveBeenCalledWith('meals/meal-1.png', expect.any(Buffer), expect.anything())
    expect(mockExtractHue).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]))
    expect(mockAttach).toHaveBeenCalledWith(expect.objectContaining({ mealId: 'meal-1' }), {
      url: BLOB_URL,
      hue: 264,
      vessel: null,
    })
    expect(mockDel).not.toHaveBeenCalled()
  })

  it('attaches the vessel estimate the image was fitted at (HON-1034)', async () => {
    // The vessel calls answer a 22 cm plate, the judge calls a clean verdict.
    // The mocked bytes are not a PNG, so the fit fails and the image is kept
    // as drawn; the estimate is stored all the same, for a refit to fit from.
    mockGenerateObject.mockImplementation((async (opts: { schema: unknown }) =>
      opts.schema === vesselSchema
        ? {
            object: { vessel: 'plate', diameterCm: 22 },
            usage: (cleanJudge as { usage: unknown }).usage,
          }
        : cleanJudge) as never)

    const response = await post()

    expect(response.status).toBe(200)
    expect(mockAttach).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ vessel: { vessel: 'plate', diameterCm: 22 } }),
    )
  })

  it('draws the ingredients by weight, so a piece of pita outranks 3 g of cumin', async () => {
    await post()

    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('largest amount first: pita, cumin.'),
      }),
    )
  })

  it('records the image, the judge and the vessel spend as meal_image rows', async () => {
    await post()

    // The drawing, the judge, and the three vessel samples (`VESSEL_SAMPLES`)
    // that set the footprint (HON-1024). The vessel mock here answers the judge
    // shape, which reads as "not classified", so the bytes are stored as drawn.
    expect(mockRecordAiUsage).toHaveBeenCalledTimes(2 + 3)
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
        model: 'claude-sonnet-5-5',
      }),
    )
  })

  it('answers 202 without generating when another request won the claim', async () => {
    mockClaim.mockResolvedValue(null)

    const response = await post()

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'generating' })
    expect(mockGenerateImage).not.toHaveBeenCalled()
    expect(mockAttach).not.toHaveBeenCalled()
  })

  it('answers 202 to a poll on a fresh claim without spending a rate-limit token', async () => {
    seedMeal({ imageStatus: 'generating', imageClaimedAt: new Date(Date.now() - 60_000) })

    const response = await post()

    expect(response.status).toBe(202)
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
    expect(mockClaim).not.toHaveBeenCalled()
  })

  it('tries to reclaim a claim older than 3 minutes', async () => {
    seedMeal({ imageStatus: 'generating', imageClaimedAt: new Date(Date.now() - 3 * 60_000 - 1) })

    const response = await post()

    expect(response.status).toBe(200)
    expect(mockClaim).toHaveBeenCalledTimes(1)
    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
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
    expect(mockClaim).not.toHaveBeenCalled()
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })

  it('never generates a global meal', async () => {
    seedMeal({ householdId: null })

    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'none' })
    expect(mockClaim).not.toHaveBeenCalled()
    expect(mockAssertUnderCap).not.toHaveBeenCalled()
  })

  it('answers 202 for a global meal the batch is generating, without claiming it', async () => {
    seedMeal({ householdId: null, imageStatus: 'generating', imageClaimedAt: new Date(0) })

    const response = await post()

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'generating' })
    expect(mockClaim).not.toHaveBeenCalled()
  })

  it('never redraws a global image at a stale prompt version', async () => {
    seedMeal({
      householdId: null,
      imageStatus: 'ready',
      imageUrl: BLOB_URL,
      imagePromptVersion: 'v3',
    })

    expect(await (await post()).json()).toEqual({ status: 'none' })
    expect(mockClaim).not.toHaveBeenCalled()
  })

  it('serves a global meal image the batch already made', async () => {
    seedMeal({
      householdId: null,
      imageStatus: 'ready',
      imageUrl: BLOB_URL,
      imagePromptVersion: 'v4',
    })

    expect(await (await post()).json()).toEqual({
      status: 'ready',
      imageUrl: BLOB_URL,
      imageHue: null,
    })
  })

  it('redraws a household image at a stale prompt version and deletes the old blob', async () => {
    seedMeal({ imageStatus: 'ready', imageUrl: OLD_BLOB_URL, imagePromptVersion: 'v3' })

    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready', imageUrl: BLOB_URL, imageHue: 264 })
    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
    expect(mockDel).toHaveBeenCalledTimes(1)
    expect(mockDel).toHaveBeenCalledWith(OLD_BLOB_URL)
  })

  it('keeps the old blob when a stale-version redraw fails', async () => {
    seedMeal({ imageStatus: 'ready', imageUrl: OLD_BLOB_URL, imagePromptVersion: 'v3' })
    mockGenerateImage.mockRejectedValue(new Error('boom'))

    await post()

    expect(mockMarkFailed).toHaveBeenCalledWith(expect.objectContaining({ redraw: true }), {
      countAttempt: true,
    })
    expect(mockDel).not.toHaveBeenCalledWith(OLD_BLOB_URL)
  })

  it('discards the image when the claim was lost mid-generation', async () => {
    seedMeal({ imageStatus: 'failed', imageUrl: OLD_BLOB_URL, imageAttempts: 1 })
    mockAttach.mockResolvedValue(false)

    const response = await post()

    expect(await response.json()).toEqual({ status: 'none' })
    expect(mockPut).toHaveBeenCalledTimes(1)
    expect(mockDel).toHaveBeenCalledTimes(1)
    expect(mockDel).toHaveBeenCalledWith(BLOB_URL)
  })

  it('attaches a null hue and still returns ready when extraction fails', async () => {
    mockExtractHue.mockRejectedValueOnce(new Error('unsupported image format'))

    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready', imageUrl: BLOB_URL, imageHue: null })
    expect(mockAttach).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ url: BLOB_URL, hue: null }),
    )
    expect(mockDel).not.toHaveBeenCalled()
    expect(captureApiError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ operation: 'meal-image-hue', mealId: 'meal-1' }),
    )
  })

  it('attaches a null hue when the image carries no colour', async () => {
    mockExtractHue.mockResolvedValueOnce(hue(null))

    await post()

    expect(mockAttach).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hue: null }),
    )
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it('marks the image failed and counts the attempt when generation fails', async () => {
    mockGenerateImage.mockRejectedValue(new Error('boom'))

    const response = await post()

    expect(response.status).toBe(500)
    expect(mockMarkFailed).toHaveBeenCalledWith(expect.objectContaining({ mealId: 'meal-1' }), {
      countAttempt: true,
    })
    expect(mockRelease).not.toHaveBeenCalled()
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('still maps the original error when marking the failure throws', async () => {
    mockGenerateImage.mockRejectedValue(new Error('boom'))
    mockMarkFailed.mockRejectedValue(new Error('db down'))

    const response = await post()

    expect(response.status).toBe(500)
    expect(captureApiError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ operation: 'meal-image-mark-failed' }),
    )
  })

  const rateLimited = (headers?: Record<string, string>, responseBody?: string) =>
    new APICallError({
      message: 'Rate limit reached for gpt-image-2.5-flare',
      url: 'https://api.openai.com/v1/images/generations',
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: headers,
      responseBody,
      isRetryable: true,
    })

  describe('a provider 429', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('waits one 15 s backoff and succeeds on the retry', async () => {
      mockGenerateImage.mockRejectedValueOnce(rateLimited()).mockResolvedValueOnce(imageResult)

      const pending = post()
      await vi.advanceTimersByTimeAsync(14_999)
      expect(mockGenerateImage).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      const response = await pending

      expect(mockGenerateImage).toHaveBeenCalledTimes(2)
      expect(response.status).toBe(200)
      expect(mockAttach).toHaveBeenCalledTimes(1)
      expect(mockMarkFailed).not.toHaveBeenCalled()
    })

    it('that persists releases the claim without counting an attempt', async () => {
      seedMeal({ imageStatus: 'failed', imageAttempts: 2 })
      mockGenerateImage.mockRejectedValue(rateLimited())

      const pending = post()
      await vi.advanceTimersByTimeAsync(15_000)
      const response = await pending

      // One retry, never a second: a second 15 s wait would not fit the budget.
      expect(mockGenerateImage).toHaveBeenCalledTimes(2)
      expect(response.status).toBe(429)
      expect(await response.json()).toMatchObject({ status: 'none' })
      expect(mockRelease).toHaveBeenCalledWith(expect.objectContaining({ mealId: 'meal-1' }))
      expect(mockMarkFailed).not.toHaveBeenCalled()
    })

    it('asking for longer than 15 s is released at once, without waiting', async () => {
      mockGenerateImage.mockRejectedValue(rateLimited({ 'retry-after': '40' }))

      const response = await post()

      expect(mockGenerateImage).toHaveBeenCalledTimes(1)
      expect(response.status).toBe(429)
      expect(mockRelease).toHaveBeenCalledTimes(1)
    })

    it('released on a stale-version redraw keeps the old blob', async () => {
      seedMeal({
        imageStatus: 'ready',
        imageUrl: OLD_BLOB_URL,
        imageHue: 120,
        imagePromptVersion: 'v3',
      })
      mockGenerateImage.mockRejectedValue(rateLimited({ 'retry-after': '40' }))

      const response = await post()

      expect(response.status).toBe(429)
      expect(mockRelease).toHaveBeenCalledWith(expect.objectContaining({ redraw: true }))
      expect(mockDel).not.toHaveBeenCalled()
    })

    it('for an exhausted quota answers 503 at once, and counts no attempt', async () => {
      seedMeal({ imageStatus: 'failed', imageAttempts: 1 })
      mockGenerateImage.mockRejectedValue(
        rateLimited(undefined, '{"error":{"code":"insufficient_quota"}}'),
      )

      const response = await post()

      expect(mockGenerateImage).toHaveBeenCalledTimes(1)
      expect(response.status).toBe(503)
      expect(mockMarkFailed).toHaveBeenCalledWith(expect.anything(), { countAttempt: false })
      expect(mockRelease).not.toHaveBeenCalled()
    })

    it('still releases when the SDK wraps it in a RetryError', async () => {
      const busy = rateLimited({ 'retry-after': '40' })
      mockGenerateImage.mockRejectedValue(
        new RetryError({ message: 'failed', reason: 'maxRetriesExceeded', errors: [busy, busy] }),
      )

      const response = await post()

      expect(response.status).toBe(429)
      expect(mockRelease).toHaveBeenCalledTimes(1)
      expect(mockMarkFailed).not.toHaveBeenCalled()
    })
  })

  it('deletes the uploaded blob when the final write throws', async () => {
    mockAttach.mockRejectedValue(new Error('db down'))

    const response = await post()

    expect(response.status).toBe(500)
    expect(mockDel).toHaveBeenCalledWith(BLOB_URL)
  })

  it('answers 504 when the AI budget runs out', async () => {
    mockGenerateImage.mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }))

    const response = await post()

    expect(response.status).toBe(504)
    expect(mockMarkFailed).toHaveBeenCalledWith(expect.anything(), { countAttempt: true })
  })

  it('answers 503 without an OpenAI key, and claims nothing', async () => {
    env.OPENAI_API_KEY = undefined

    const response = await post()

    expect(response.status).toBe(503)
    expect(mockClaim).not.toHaveBeenCalled()
    expect(mockGenerateImage).not.toHaveBeenCalled()
  })

  describe('with ai_generation_enabled off (HON-868)', () => {
    beforeEach(() => {
      mockGetServerFlag.mockResolvedValue(false)
    })

    it('answers 503 without claiming or calling a model', async () => {
      const response = await post()

      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ status: 'failed' })
      expect(mockGetServerFlag).toHaveBeenCalledWith('ai_generation_enabled', 'user-123')
      expect(mockAssertUnderCap).not.toHaveBeenCalled()
      // No claim is taken and no attempt counted, so the meal is drawn once
      // the flag is back on.
      expect(mockClaim).not.toHaveBeenCalled()
      expect(mockGenerateImage).not.toHaveBeenCalled()
      expect(mockGenerateObject).not.toHaveBeenCalled()
    })

    it('still serves an existing image', async () => {
      seedMeal({
        imageStatus: 'ready',
        imageUrl: BLOB_URL,
        imageHue: 120,
        imagePromptVersion: 'v4',
      })

      const response = await post()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'ready', imageUrl: BLOB_URL, imageHue: 120 })
      expect(mockGenerateImage).not.toHaveBeenCalled()
    })
  })

  it('returns the shared cap error shape over the cap, and claims nothing', async () => {
    mockAssertUnderCap.mockRejectedValue(
      new AiCostCapExceededError(new Date(Date.now() + 86_400_000), 'Europe/Tallinn'),
    )

    const response = await post()

    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({
      error: 'AI usage cap exceeded',
      code: 'ai_cap_exceeded',
    })
    expect(mockClaim).not.toHaveBeenCalled()
    expect(mockGenerateImage).not.toHaveBeenCalled()
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
    expect(mockClaim).not.toHaveBeenCalled()
  })
})

describe('GET /api/meals/[id]/image', () => {
  const get = () =>
    GET(new Request('http://localhost/api/meals/meal-1/image'), {
      params: Promise.resolve({ id: 'meal-1' }),
    })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(session as never)
    mockGetMembership.mockResolvedValue(membership as never)
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
  })

  it('returns 404 for a meal the household cannot see', async () => {
    mockReadImage.mockResolvedValue(null)

    const response = await get()

    expect(response.status).toBe(404)
    expect(mockReadImage).toHaveBeenCalledWith(HOUSEHOLD_ID, 'meal-1')
  })

  it('returns a ready image with its hue', async () => {
    mockReadImage.mockResolvedValue({ imageStatus: 'ready', imageUrl: BLOB_URL, imageHue: 40 })

    const response = await get()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready', imageUrl: BLOB_URL, imageHue: 40 })
  })

  it('reports a ready status with no URL as none', async () => {
    mockReadImage.mockResolvedValue({ imageStatus: 'ready', imageUrl: null, imageHue: null })

    expect(await (await get()).json()).toEqual({ status: 'none' })
  })

  it('returns the { error } shape when the read fails', async () => {
    mockReadImage.mockRejectedValueOnce(new Error('db down'))

    const response = await get()

    expect(response.status).toBe(500)
    expect(await response.json()).toHaveProperty('error')
  })

  it.each(['none', 'generating', 'failed'] as const)(
    'returns the stored %s status without claiming or generating',
    async (imageStatus) => {
      mockReadImage.mockResolvedValue({ imageStatus, imageUrl: null, imageHue: null })

      const response = await get()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: imageStatus })
      expect(mockClaim).not.toHaveBeenCalled()
      expect(mockGenerateImage).not.toHaveBeenCalled()
      expect(mockCheckRateLimit).not.toHaveBeenCalled()
    },
  )
})
