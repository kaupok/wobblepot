import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { JudgeV2Findings } from './judge'
import type { MealImageMeal } from './prompt'
import { vesselSchema, type Vessel } from './vessel'

// Never call the real APIs: both SDK entry points are mocked, and the providers
// are stubs that only record the model id they were asked for.
const env = vi.hoisted(() => ({
  OPENAI_API_KEY: 'sk-test' as string | undefined,
  ANTHROPIC_API_KEY: 'sk-ant-test',
}))

vi.mock('@/lib/env', () => ({ serverEnv: env }))

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

// The fit is sharp over real pixels, tested in footprint.test.ts; here it is a
// stub that returns the bytes as they are unless a test says otherwise.
vi.mock('./footprint', () => ({
  fitFootprint: vi.fn(async (bytes: Uint8Array, mediaType: string, vessel: Vessel) => ({
    bytes,
    mediaType,
    fit: {
      vessel,
      shape: vessel,
      depth: null,
      measuredWidth: 0.58,
      targetWidth: 0.58,
      elevationDeg: 40,
      scale: 1,
      action: 'keep',
      reason: 'already at the target width',
    },
  })),
}))

import { APICallError, generateImage, generateObject, RetryError } from 'ai'
import { fitFootprint } from './footprint'
import {
  classifyVessel,
  generateMealImage,
  IMAGE_FALLBACK_USD,
  MealImageUnavailableError,
  RATE_LIMIT_BACKOFF_MS,
  rateLimitDelayMs,
  RETRY_MIN_REMAINING_MS,
  TRANSIENT_RETRY_MS,
} from './generate'

const mockGenerateImage = vi.mocked(generateImage)
const mockGenerateObject = vi.mocked(generateObject)
const mockFit = vi.mocked(fitFootprint)

const meal: MealImageMeal = {
  name: 'Greek Salad with Feta',
  description: 'Fresh salad with tomatoes, cucumber, and feta cheese',
  components: [
    { name: 'feta cheese', quantity: 100, unit: 'g' },
    { name: 'tomato', quantity: 120, unit: 'g' },
  ],
}

const clean: JudgeV2Findings = {
  extraIngredients: [],
  propsOrCookware: [],
  missingIngredients: [],
  portion: 'one-serving',
}

const imageResult = (bytes = [1], usage = { inputTokens: 110, outputTokens: 1_372 }) =>
  ({
    image: { uint8Array: new Uint8Array(bytes), mediaType: 'image/png' },
    usage: { ...usage, totalTokens: undefined },
  }) as never

const judgeResult = (object: JudgeV2Findings) =>
  ({
    object,
    usage: {
      inputTokens: 2_000,
      outputTokens: 500,
      inputTokenDetails: { noCacheTokens: 2_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
  }) as never

const vesselResult = (vessel: string = 'plate') =>
  ({
    object: { vessel, reason: 'a shallow dish with a wide rim' },
    usage: {
      inputTokens: 2_500,
      outputTokens: 40,
      inputTokenDetails: { noCacheTokens: 2_500, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
  }) as never

const IMAGE_USD = (110 * 5 + 1_372 * 30) / 1_000_000
const JUDGE_USD = (2_000 * 2 + 500 * 10) / 1_000_000
const VESSEL_USD = (2_500 * 2 + 40 * 10) / 1_000_000

type ObjectCall = { schema: unknown }
const isVesselCall = (call: unknown[]) => (call[0] as ObjectCall).schema === vesselSchema

/**
 * `generateObject` serves two callers: the judge (answers in order, the last
 * one repeating) and the vessel call (`vessel`, a result or an error).
 */
function answers(
  judge: Array<JudgeV2Findings | Error>,
  vessel: string | Error | undefined = 'plate',
) {
  let i = 0
  mockGenerateObject.mockImplementation(async (opts) => {
    if ((opts as ObjectCall).schema === vesselSchema) {
      if (vessel instanceof Error) throw vessel
      return vesselResult(vessel)
    }
    const a = judge[Math.min(i++, judge.length - 1)]
    if (a instanceof Error) throw a
    return judgeResult(a as JudgeV2Findings)
  })
}

const judgeCalls = () => mockGenerateObject.mock.calls.filter((c) => !isVesselCall(c)).length
const vesselCalls = () => mockGenerateObject.mock.calls.filter(isVesselCall).length

describe('generateMealImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    env.OPENAI_API_KEY = 'sk-test'
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('generates once and keeps an image that passes the judge', async () => {
    mockGenerateImage.mockResolvedValue(imageResult([7, 8]))
    answers([clean])

    const result = await generateMealImage(meal)

    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { imageModelId: 'gpt-image-2.5-flare' },
        size: '1536x1024',
        providerOptions: { openai: { quality: 'high', outputFormat: 'png' } },
        prompt: expect.stringContaining('The dish: Greek Salad with Feta'),
      }),
    )
    expect(result).toEqual({
      bytes: new Uint8Array([7, 8]),
      mediaType: 'image/png',
      attempts: 1,
      totalUsd: IMAGE_USD + JUDGE_USD + VESSEL_USD,
      verdict: expect.objectContaining({ pass: true, strictPass: true }),
      vessel: 'plate',
      fit: expect.objectContaining({ vessel: 'plate', action: 'keep' }),
    })
  })

  it('regenerates exactly once on a serious finding', async () => {
    mockGenerateImage
      .mockResolvedValueOnce(imageResult([1]))
      .mockResolvedValueOnce(imageResult([2]))
    answers([{ ...clean, extraIngredients: ['olives'] }, clean])

    const result = await generateMealImage(meal)

    expect(mockGenerateImage).toHaveBeenCalledTimes(2)
    expect(judgeCalls()).toBe(2)
    expect(result.attempts).toBe(2)
    expect(result.bytes).toEqual(new Uint8Array([2]))
    // The verdict belongs to the image returned, not the rejected first one.
    expect(result.verdict?.pass).toBe(true)
  })

  it('regenerates on props beside the dish too', async () => {
    mockGenerateImage.mockResolvedValue(imageResult())
    answers([{ ...clean, propsOrCookware: ['cutting board'] }, clean])

    await generateMealImage(meal)

    expect(mockGenerateImage).toHaveBeenCalledTimes(2)
  })

  it('does not regenerate on a minor-only finding', async () => {
    mockGenerateImage.mockResolvedValue(imageResult())
    answers([{ ...clean, missingIngredients: ['tomato'], portion: 'several-servings' }])

    const result = await generateMealImage(meal)

    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
    expect(result.attempts).toBe(1)
  })

  it('does not regenerate when the only extra names a listed ingredient', async () => {
    mockGenerateImage.mockResolvedValue(imageResult())
    answers([{ ...clean, extraIngredients: ['crumbled feta'] }])

    await generateMealImage(meal)

    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
  })

  it('keeps the second image and warns when it also fails the judge', async () => {
    mockGenerateImage
      .mockResolvedValueOnce(imageResult([1]))
      .mockResolvedValueOnce(imageResult([2]))
    answers([{ ...clean, extraIngredients: ['olives'] }])

    const result = await generateMealImage(meal, { mealId: 'meal-1' })

    expect(mockGenerateImage).toHaveBeenCalledTimes(2)
    expect(result.bytes).toEqual(new Uint8Array([2]))
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('also failed the judge'))
  })

  it('logs the raw findings beside the filtered ones', async () => {
    mockGenerateImage.mockResolvedValue(imageResult())
    answers([{ ...clean, extraIngredients: ['crumbled feta'] }])

    await generateMealImage(meal, { mealId: 'meal-1' })

    const judgeLog = vi.mocked(console.info).mock.calls.find(([l]) => l === '[meal-image] judge')
    expect(judgeLog).toBeDefined()
    expect(JSON.parse(judgeLog![1] as string)).toMatchObject({
      mealId: 'meal-1',
      attempt: 1,
      pass: true,
      raw: { extraIngredients: ['crumbled feta'] },
      filtered: { extraIngredients: [] },
    })
  })

  it('reports the image, the judge and the vessel call as separate usage rows', async () => {
    mockGenerateImage.mockResolvedValue(imageResult())
    answers([clean])
    const onUsage = vi.fn()

    await generateMealImage(meal, { onUsage })

    expect(onUsage).toHaveBeenCalledTimes(3)
    expect(onUsage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        model: 'gpt-image-2.5-flare',
        inputTokens: 110,
        outputTokens: 1_372,
        usageMissing: false,
        // Each call carries its own time, for `$ai_latency`.
        durationMs: expect.any(Number),
      }),
    )
    // The judge and the vessel call run side by side, so their order is not fixed.
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-5-5',
        inputTokens: 2_000,
        outputTokens: 500,
        durationMs: expect.any(Number),
      }),
    )
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-5-5',
        inputTokens: 2_500,
        outputTokens: 40,
        durationMs: expect.any(Number),
      }),
    )
  })

  it('prices an image with no token usage at the flat fallback', async () => {
    mockGenerateImage.mockResolvedValue(
      imageResult([1], { inputTokens: undefined, outputTokens: undefined } as never),
    )
    answers([clean])
    const onUsage = vi.fn()

    const result = await generateMealImage(meal, { onUsage })

    expect(onUsage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ usageMissing: true, fallbackCostUsd: IMAGE_FALLBACK_USD }),
    )
    expect(result.totalUsd).toBeCloseTo(IMAGE_FALLBACK_USD + JUDGE_USD + VESSEL_USD)
  })

  it('keeps the image when the judge call fails', async () => {
    mockGenerateImage.mockResolvedValue(imageResult([3]))
    answers([new Error('overloaded')])

    const result = await generateMealImage(meal)

    expect(result.bytes).toEqual(new Uint8Array([3]))
    expect(result.verdict).toBeNull()
    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
  })

  it('keeps the image when the judge runs out of budget', async () => {
    mockGenerateImage.mockResolvedValue(imageResult([4]))
    answers([Object.assign(new Error('t'), { name: 'TimeoutError' })])

    const result = await generateMealImage(meal)

    expect(result).toMatchObject({ bytes: new Uint8Array([4]), attempts: 1 })
  })

  it('keeps the first image when the regeneration runs out of budget', async () => {
    mockGenerateImage
      .mockResolvedValueOnce(imageResult([1]))
      .mockRejectedValueOnce(Object.assign(new Error('t'), { name: 'TimeoutError' }))
    answers([{ ...clean, extraIngredients: ['olives'] }])

    const result = await generateMealImage(meal)

    expect(mockGenerateImage).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ bytes: new Uint8Array([1]), attempts: 1 })
  })

  it('keeps the first image when the regeneration fails for any other reason', async () => {
    mockGenerateImage
      .mockResolvedValueOnce(imageResult([1]))
      .mockRejectedValueOnce(new Error('content policy'))
    answers([{ ...clean, extraIngredients: ['olives'] }])

    const result = await generateMealImage(meal)

    expect(result).toMatchObject({ bytes: new Uint8Array([1]), attempts: 1 })
  })

  it('rethrows a budget timeout from the first draw', async () => {
    mockGenerateImage.mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }))

    await expect(generateMealImage(meal)).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it('keeps the first image when the budget has no room for a regeneration', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0)
    mockGenerateImage.mockImplementation(async () => {
      now.mockReturnValue(30_000)
      return imageResult([1])
    })
    answers([{ ...clean, extraIngredients: ['olives'] }])

    const result = await generateMealImage(meal, { budgetMs: 30_000 + RETRY_MIN_REMAINING_MS - 1 })

    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
    expect(result.attempts).toBe(1)
  })

  it("judges once and never regenerates in 'report' mode", async () => {
    mockGenerateImage.mockResolvedValue(imageResult())
    answers([{ ...clean, extraIngredients: ['olives'] }])

    const result = await generateMealImage(meal, { judge: 'report' })

    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
    expect(judgeCalls()).toBe(1)
    expect(result.attempts).toBe(1)
    expect(result.verdict).toMatchObject({
      pass: false,
      filtered: { extraIngredients: ['olives'] },
    })
    expect(result.totalUsd).toBeCloseTo(IMAGE_USD + JUDGE_USD + VESSEL_USD)
  })

  it("makes no judge call in 'off' mode, but still fits the image", async () => {
    mockGenerateImage.mockResolvedValue(imageResult())
    answers([])

    const result = await generateMealImage(meal, { judge: 'off' })

    expect(judgeCalls()).toBe(0)
    expect(vesselCalls()).toBe(1)
    expect(result).toMatchObject({ attempts: 1, verdict: null, vessel: 'plate' })
    expect(result.totalUsd).toBeCloseTo(IMAGE_USD + VESSEL_USD)
  })

  describe('vessel fit (HON-1024)', () => {
    it('returns the fitted bytes and the fit for the kept image', async () => {
      mockGenerateImage.mockResolvedValue(imageResult([1, 2]))
      answers([clean], 'bowl')
      mockFit.mockResolvedValueOnce({
        bytes: new Uint8Array([9, 9, 9]),
        mediaType: 'image/png',
        fit: {
          vessel: 'bowl',
          shape: 'bowl',
          depth: 0.9,
          measuredWidth: 0.46,
          targetWidth: 0.42,
          elevationDeg: null,
          scale: 0.42 / 0.46,
          action: 'fit',
        },
      })

      const result = await generateMealImage(meal, { mealId: 'meal-1' })

      expect(mockFit).toHaveBeenCalledWith(new Uint8Array([1, 2]), 'image/png', 'bowl')
      expect(result.bytes).toEqual(new Uint8Array([9, 9, 9]))
      expect(result.vessel).toBe('bowl')
      expect(result.fit).toMatchObject({ action: 'fit', targetWidth: 0.42 })
      const fitLog = vi.mocked(console.info).mock.calls.find(([l]) => l === '[meal-image] fit')
      expect(JSON.parse(fitLog![1] as string)).toMatchObject({ mealId: 'meal-1', vessel: 'bowl' })
    })

    it('classifies and fits the regenerated image, not the rejected first one', async () => {
      mockGenerateImage
        .mockResolvedValueOnce(imageResult([1]))
        .mockResolvedValueOnce(imageResult([2]))
      answers([{ ...clean, extraIngredients: ['olives'] }, clean])

      await generateMealImage(meal)

      expect(vesselCalls()).toBe(2)
      expect(mockFit).toHaveBeenCalledTimes(1)
      expect(mockFit).toHaveBeenCalledWith(new Uint8Array([2]), 'image/png', 'plate')
    })

    it('keeps the image as drawn when the vessel call fails', async () => {
      mockGenerateImage.mockResolvedValue(imageResult([5]))
      answers([clean], new Error('overloaded'))

      const result = await generateMealImage(meal)

      expect(mockFit).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        bytes: new Uint8Array([5]),
        vessel: null,
        fit: null,
        verdict: expect.objectContaining({ pass: true }),
      })
      expect(result.totalUsd).toBeCloseTo(IMAGE_USD + JUDGE_USD)
    })

    it('keeps the image as drawn when the model names no known vessel', async () => {
      mockGenerateImage.mockResolvedValue(imageResult([5]))
      answers([clean], 'tureen')

      const result = await generateMealImage(meal)

      expect(mockFit).not.toHaveBeenCalled()
      expect(result).toMatchObject({ vessel: null, fit: null })
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('nothing known'))
    })

    it('keeps the image as drawn when the fit itself fails', async () => {
      mockGenerateImage.mockResolvedValue(imageResult([6]))
      answers([clean])
      mockFit.mockRejectedValueOnce(new Error('Input buffer contains unsupported image format'))

      const result = await generateMealImage(meal)

      expect(result).toMatchObject({ bytes: new Uint8Array([6]), vessel: 'plate', fit: null })
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('fit failed'),
        expect.any(Error),
      )
    })

    it('makes no vessel call with fit: false', async () => {
      mockGenerateImage.mockResolvedValue(imageResult())
      answers([clean])

      const result = await generateMealImage(meal, { fit: false })

      expect(vesselCalls()).toBe(0)
      expect(mockFit).not.toHaveBeenCalled()
      expect(result).toMatchObject({ vessel: null, fit: null })
      expect(result.totalUsd).toBeCloseTo(IMAGE_USD + JUDGE_USD)
    })
  })

  describe('classifyVessel', () => {
    it('asks REVIEW_MODEL with the image and the vessel prompt, and reports the usage', async () => {
      answers([], 'glass')
      const onUsage = vi.fn()

      const vessel = await classifyVessel(
        { bytes: new Uint8Array([1]), mediaType: 'image/png' },
        { onUsage },
      )

      expect(vessel).toBe('glass')
      expect(mockGenerateObject).toHaveBeenCalledWith(
        expect.objectContaining({
          model: { languageModelId: 'claude-sonnet-5-5' },
          schema: vesselSchema,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'file', data: new Uint8Array([1]), mediaType: 'image/png' },
                { type: 'text', text: expect.stringContaining('Which single vessel') },
              ],
            },
          ],
        }),
      )
      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-5-5', inputTokens: 2_500 }),
      )
    })

    it('returns null instead of throwing', async () => {
      answers([], new Error('overloaded'))
      await expect(
        classifyVessel({ bytes: new Uint8Array([1]), mediaType: 'image/png' }),
      ).resolves.toBeNull()
    })
  })

  it('refuses without an OpenAI key, before any call', async () => {
    env.OPENAI_API_KEY = undefined

    await expect(generateMealImage(meal)).rejects.toBeInstanceOf(MealImageUnavailableError)
    expect(mockGenerateImage).not.toHaveBeenCalled()
  })
})

const apiError = (
  statusCode: number,
  { headers, message = 'error' }: { headers?: Record<string, string>; message?: string } = {},
) =>
  new APICallError({
    message,
    url: 'https://api.openai.com/v1/images/generations',
    requestBodyValues: {},
    statusCode,
    responseHeaders: headers,
  })

describe('rateLimitDelayMs', () => {
  it('reads retry-after-ms, then retry-after in seconds', () => {
    expect(rateLimitDelayMs(apiError(429, { headers: { 'retry-after-ms': '1500' } }))).toBe(1500)
    expect(rateLimitDelayMs(apiError(429, { headers: { 'retry-after': '12' } }))).toBe(12_000)
  })

  it('reads retry-after as an HTTP date', () => {
    vi.useFakeTimers({ now: new Date('2026-09-22T12:00:00Z') })
    try {
      const headers = { 'retry-after': 'Tue, 22 Sep 2026 12:00:20 GMT' }
      expect(rateLimitDelayMs(apiError(429, { headers }))).toBe(20_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it("falls back to OpenAI's 'try again in Ns' text", () => {
    const message =
      'Rate limit reached for gpt-image-2.5-flare on input-images per min: Limit 5, Used 5, Requested 1. Please try again in 12s.'
    expect(rateLimitDelayMs(apiError(429, { message }))).toBe(12_000)
    expect(rateLimitDelayMs(apiError(429, { message: 'Please try again in 850ms.' }))).toBe(850)
  })

  it('looks through a RetryError to its last error', () => {
    const busy = apiError(429, { headers: { 'retry-after': '3' } })
    const wrapped = new RetryError({ message: 'x', reason: 'maxRetriesExceeded', errors: [busy] })
    expect(rateLimitDelayMs(wrapped)).toBe(3_000)
  })

  it('is undefined when nothing names a delay', () => {
    expect(rateLimitDelayMs(apiError(429))).toBeUndefined()
    expect(rateLimitDelayMs(new Error('try again in 5s'))).toBeUndefined()
  })
})

describe('generateMealImage on a 429 (HON-742)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    env.OPENAI_API_KEY = 'sk-test'
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    answers([clean])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('leaves retries to itself, not the SDK', async () => {
    mockGenerateImage.mockResolvedValue(imageResult())

    await generateMealImage(meal, { judge: 'off' })

    expect(mockGenerateImage).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }))
  })

  it('retries after the 12 s retry-after asks for, and succeeds on the second attempt', async () => {
    mockGenerateImage
      .mockRejectedValueOnce(apiError(429, { headers: { 'retry-after': '12' } }))
      .mockResolvedValueOnce(imageResult([9]))

    const pending = generateMealImage(meal, { judge: 'off' })
    await vi.advanceTimersByTimeAsync(11_999)
    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    const result = await pending

    expect(mockGenerateImage).toHaveBeenCalledTimes(2)
    expect(result.bytes).toEqual(new Uint8Array([9]))
    // The rejected call was never billed; the vessel call on the kept image was.
    expect(result.totalUsd).toBeCloseTo(IMAGE_USD + VESSEL_USD)
  })

  it('backs off 15 s, 30 s, 60 s without a named delay, then gives up', async () => {
    const busy = apiError(429)
    mockGenerateImage.mockRejectedValue(busy)

    const pending = generateMealImage(meal, { judge: 'off' })
    const settled = pending.catch((error: unknown) => error)

    let elapsed = 0
    for (const [i, step] of RATE_LIMIT_BACKOFF_MS.entries()) {
      await vi.advanceTimersByTimeAsync(step - 1)
      expect(mockGenerateImage).toHaveBeenCalledTimes(i + 1)
      await vi.advanceTimersByTimeAsync(1)
      elapsed += step
    }

    expect(await settled).toBe(busy)
    expect(mockGenerateImage).toHaveBeenCalledTimes(4)
    expect(elapsed).toBe(105_000)
  })

  it('honours rateLimitRetries and maxRateLimitWaitMs', async () => {
    mockGenerateImage.mockRejectedValue(apiError(429, { headers: { 'retry-after': '20' } }))

    await expect(
      generateMealImage(meal, { judge: 'off', maxRateLimitWaitMs: 15_000 }),
    ).rejects.toMatchObject({ statusCode: 429 })
    expect(mockGenerateImage).toHaveBeenCalledTimes(1)

    mockGenerateImage.mockClear()
    await expect(
      generateMealImage(meal, { judge: 'off', rateLimitRetries: 0 }),
    ).rejects.toMatchObject({ statusCode: 429 })
    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
  })

  it('does not wait when the image after the wait would not fit the budget', async () => {
    mockGenerateImage.mockRejectedValue(apiError(429))

    await expect(
      generateMealImage(meal, { judge: 'off', budgetMs: 15_000 + RETRY_MIN_REMAINING_MS - 1 }),
    ).rejects.toMatchObject({ statusCode: 429 })
    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
  })

  it('stops waiting when the abort signal fires', async () => {
    mockGenerateImage.mockRejectedValue(apiError(429))
    const controller = new AbortController()

    const pending = generateMealImage(meal, { judge: 'off', abortSignal: controller.signal })
    const settled = pending.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(1_000)
    controller.abort(new DOMException('budget', 'TimeoutError'))

    expect(await settled).toMatchObject({ name: 'TimeoutError' })
    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
  })

  it('retries any other retryable error once, after a short wait', async () => {
    const down = apiError(503)
    mockGenerateImage.mockRejectedValueOnce(down).mockResolvedValueOnce(imageResult())

    const pending = generateMealImage(meal, { judge: 'off' })
    await vi.advanceTimersByTimeAsync(TRANSIENT_RETRY_MS)
    await pending
    expect(mockGenerateImage).toHaveBeenCalledTimes(2)

    mockGenerateImage.mockClear()
    mockGenerateImage.mockRejectedValue(down)
    const failing = generateMealImage(meal, { judge: 'off' }).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(TRANSIENT_RETRY_MS * 4)
    expect(await failing).toBe(down)
    expect(mockGenerateImage).toHaveBeenCalledTimes(2)
  })

  it('gives up at once on an exhausted quota, which no wait clears', async () => {
    mockGenerateImage.mockRejectedValue(
      new APICallError({
        message: 'You exceeded your current quota',
        url: 'https://api.openai.com/v1/images/generations',
        requestBodyValues: {},
        statusCode: 429,
        responseBody: '{"error":{"code":"insufficient_quota"}}',
      }),
    )

    await expect(generateMealImage(meal, { judge: 'off' })).rejects.toMatchObject({
      statusCode: 429,
    })
    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
  })

  it('does not retry a non-retryable error', async () => {
    mockGenerateImage.mockRejectedValue(apiError(400))

    await expect(generateMealImage(meal, { judge: 'off' })).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
  })

  it('never waits out a 429 on the regeneration, and keeps the first image', async () => {
    mockGenerateImage
      .mockResolvedValueOnce(imageResult([1]))
      .mockRejectedValueOnce(apiError(429, { headers: { 'retry-after': '1' } }))
    answers([{ ...clean, extraIngredients: ['olives'] }])

    const result = await generateMealImage(meal)

    expect(mockGenerateImage).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ attempts: 1, bytes: new Uint8Array([1]) })
  })
})
