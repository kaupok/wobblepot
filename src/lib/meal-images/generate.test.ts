import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { JudgeV2Findings } from './judge'
import type { MealImageMeal } from './prompt'

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

import { APICallError, generateImage, generateObject, RetryError } from 'ai'
import {
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

const IMAGE_USD = (110 * 5 + 1_372 * 30) / 1_000_000
const JUDGE_USD = (2_000 * 2 + 500 * 10) / 1_000_000

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
    mockGenerateObject.mockResolvedValue(judgeResult(clean))

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
      totalUsd: IMAGE_USD + JUDGE_USD,
      verdict: expect.objectContaining({ pass: true, strictPass: true }),
    })
  })

  it('regenerates exactly once on a serious finding', async () => {
    mockGenerateImage
      .mockResolvedValueOnce(imageResult([1]))
      .mockResolvedValueOnce(imageResult([2]))
    mockGenerateObject
      .mockResolvedValueOnce(judgeResult({ ...clean, extraIngredients: ['olives'] }))
      .mockResolvedValueOnce(judgeResult(clean))

    const result = await generateMealImage(meal)

    expect(mockGenerateImage).toHaveBeenCalledTimes(2)
    expect(mockGenerateObject).toHaveBeenCalledTimes(2)
    expect(result.attempts).toBe(2)
    expect(result.bytes).toEqual(new Uint8Array([2]))
    // The verdict belongs to the image returned, not the rejected first one.
    expect(result.verdict?.pass).toBe(true)
  })

  it('regenerates on props beside the dish too', async () => {
    mockGenerateImage.mockResolvedValue(imageResult())
    mockGenerateObject
      .mockResolvedValueOnce(judgeResult({ ...clean, propsOrCookware: ['cutting board'] }))
      .mockResolvedValueOnce(judgeResult(clean))

    await generateMealImage(meal)

    expect(mockGenerateImage).toHaveBeenCalledTimes(2)
  })

  it('does not regenerate on a minor-only finding', async () => {
    mockGenerateImage.mockResolvedValue(imageResult())
    mockGenerateObject.mockResolvedValue(
      judgeResult({ ...clean, missingIngredients: ['tomato'], portion: 'several-servings' }),
    )

    const result = await generateMealImage(meal)

    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
    expect(result.attempts).toBe(1)
  })

  it('does not regenerate when the only extra names a listed ingredient', async () => {
    mockGenerateImage.mockResolvedValue(imageResult())
    mockGenerateObject.mockResolvedValue(
      judgeResult({ ...clean, extraIngredients: ['crumbled feta'] }),
    )

    await generateMealImage(meal)

    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
  })

  it('keeps the second image and warns when it also fails the judge', async () => {
    mockGenerateImage
      .mockResolvedValueOnce(imageResult([1]))
      .mockResolvedValueOnce(imageResult([2]))
    mockGenerateObject.mockResolvedValue(judgeResult({ ...clean, extraIngredients: ['olives'] }))

    const result = await generateMealImage(meal, { mealId: 'meal-1' })

    expect(mockGenerateImage).toHaveBeenCalledTimes(2)
    expect(result.bytes).toEqual(new Uint8Array([2]))
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('also failed the judge'))
  })

  it('logs the raw findings beside the filtered ones', async () => {
    mockGenerateImage.mockResolvedValue(imageResult())
    mockGenerateObject.mockResolvedValue(
      judgeResult({ ...clean, extraIngredients: ['crumbled feta'] }),
    )

    await generateMealImage(meal, { mealId: 'meal-1' })

    const [label, payload] = vi.mocked(console.info).mock.calls[0]!
    expect(label).toBe('[meal-image] judge')
    expect(JSON.parse(payload as string)).toMatchObject({
      mealId: 'meal-1',
      attempt: 1,
      pass: true,
      raw: { extraIngredients: ['crumbled feta'] },
      filtered: { extraIngredients: [] },
    })
  })

  it('reports the image call and the judge call as separate usage rows', async () => {
    mockGenerateImage.mockResolvedValue(imageResult())
    mockGenerateObject.mockResolvedValue(judgeResult(clean))
    const onUsage = vi.fn()

    await generateMealImage(meal, { onUsage })

    expect(onUsage).toHaveBeenCalledTimes(2)
    expect(onUsage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        model: 'gpt-image-2.5-flare',
        inputTokens: 110,
        outputTokens: 1_372,
        usageMissing: false,
      }),
    )
    expect(onUsage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: 'claude-sonnet-5', inputTokens: 2_000, outputTokens: 500 }),
    )
  })

  it('prices an image with no token usage at the flat fallback', async () => {
    mockGenerateImage.mockResolvedValue(
      imageResult([1], { inputTokens: undefined, outputTokens: undefined } as never),
    )
    mockGenerateObject.mockResolvedValue(judgeResult(clean))
    const onUsage = vi.fn()

    const result = await generateMealImage(meal, { onUsage })

    expect(onUsage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ usageMissing: true, fallbackCostUsd: IMAGE_FALLBACK_USD }),
    )
    expect(result.totalUsd).toBeCloseTo(IMAGE_FALLBACK_USD + JUDGE_USD)
  })

  it('keeps the image when the judge call fails', async () => {
    mockGenerateImage.mockResolvedValue(imageResult([3]))
    mockGenerateObject.mockRejectedValue(new Error('overloaded'))

    const result = await generateMealImage(meal)

    expect(result.bytes).toEqual(new Uint8Array([3]))
    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
  })

  it('keeps the image when the judge runs out of budget', async () => {
    mockGenerateImage.mockResolvedValue(imageResult([4]))
    mockGenerateObject.mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }))

    const result = await generateMealImage(meal)

    expect(result).toMatchObject({ bytes: new Uint8Array([4]), attempts: 1 })
  })

  it('keeps the first image when the regeneration runs out of budget', async () => {
    mockGenerateImage
      .mockResolvedValueOnce(imageResult([1]))
      .mockRejectedValueOnce(Object.assign(new Error('t'), { name: 'TimeoutError' }))
    mockGenerateObject.mockResolvedValue(judgeResult({ ...clean, extraIngredients: ['olives'] }))

    const result = await generateMealImage(meal)

    expect(mockGenerateImage).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ bytes: new Uint8Array([1]), attempts: 1 })
  })

  it('keeps the first image when the regeneration fails for any other reason', async () => {
    mockGenerateImage
      .mockResolvedValueOnce(imageResult([1]))
      .mockRejectedValueOnce(new Error('content policy'))
    mockGenerateObject.mockResolvedValue(judgeResult({ ...clean, extraIngredients: ['olives'] }))

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
    mockGenerateObject.mockResolvedValue(judgeResult({ ...clean, extraIngredients: ['olives'] }))

    const result = await generateMealImage(meal, { budgetMs: 30_000 + RETRY_MIN_REMAINING_MS - 1 })

    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
    expect(result.attempts).toBe(1)
  })

  it("judges once and never regenerates in 'report' mode", async () => {
    mockGenerateImage.mockResolvedValue(imageResult())
    mockGenerateObject.mockResolvedValue(judgeResult({ ...clean, extraIngredients: ['olives'] }))

    const result = await generateMealImage(meal, { judge: 'report' })

    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
    expect(result.attempts).toBe(1)
    expect(result.verdict).toMatchObject({
      pass: false,
      filtered: { extraIngredients: ['olives'] },
    })
    expect(result.totalUsd).toBeCloseTo(IMAGE_USD + JUDGE_USD)
  })

  it("makes no judge call in 'off' mode", async () => {
    mockGenerateImage.mockResolvedValue(imageResult())

    const result = await generateMealImage(meal, { judge: 'off' })

    expect(mockGenerateObject).not.toHaveBeenCalled()
    expect(result).toMatchObject({ attempts: 1, verdict: null })
    expect(result.totalUsd).toBeCloseTo(IMAGE_USD)
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
    mockGenerateObject.mockResolvedValue(judgeResult(clean))
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
    // The rejected call was never billed.
    expect(result.totalUsd).toBeCloseTo(IMAGE_USD)
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
    mockGenerateObject.mockResolvedValueOnce(
      judgeResult({ ...clean, extraIngredients: ['olives'] }),
    )

    const result = await generateMealImage(meal)

    expect(mockGenerateImage).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ attempts: 1, bytes: new Uint8Array([1]) })
  })
})
