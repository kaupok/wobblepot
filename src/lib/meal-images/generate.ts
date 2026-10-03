import 'server-only'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { APICallError, generateImage, generateObject, RetryError, type ImageModelUsage } from 'ai'
import { aiErrorStatusCode } from '@/lib/ai/error-status'
import { MEAL_IMAGE_MODEL, REVIEW_MODEL } from '@/lib/ai/models'
import { estimateCostUsd } from '@/lib/ai/pricing'
import { toAiUsageStats, withUsageOnFailure, type AiUsageStats } from '@/lib/ai/usage'
import { serverEnv } from '@/lib/env'
import { fitFootprint, type FootprintFit } from './footprint'
import { applyJudgeFilters, buildJudgeV2Prompt, judgeV2Schema, type JudgeVerdict } from './judge'
import { buildMealImagePrompt, type MealImageMeal } from './prompt'
import { asVesselEstimate, VESSEL_PROMPT, vesselSchema, type VesselEstimate } from './vessel'

/**
 * Generate a meal illustration with the HON-726 recipe: one image, one vision
 * judge, and at most one regeneration when the judge finds something serious
 * (an added ingredient, or props and cookware beside the dish). The image that
 * is kept is then fitted (HON-1024): a second, cheaper vision call names the
 * vessel, and `fitFootprint` scales the drawing so every plate is one width
 * and every bowl another.
 */

/** Flat price for an image whose result carries no token usage — the spike's `estPerImageUsd`. */
export const IMAGE_FALLBACK_USD = 0.05

/**
 * A regeneration is only started with this much of the caller's budget left:
 * one image (~18 s measured) plus its judge (~3.4 s), with headroom. Starting
 * one that cannot finish would turn a usable first image into a timeout.
 */
export const RETRY_MIN_REMAINING_MS = 25_000

/**
 * Waits before each retry of a rate-limited (429) image call whose response
 * names no delay (HON-742). The tier allows 5 images per minute, so the
 * window clears within a minute; the SDK's ~2 s retry never outlasted it.
 */
export const RATE_LIMIT_BACKOFF_MS = [15_000, 30_000, 60_000] as const

/** The single short retry every other retryable error gets — the SDK's `maxRetries: 1`. */
export const TRANSIENT_RETRY_MS = 2_000

const TRY_AGAIN_IN = /try again in (\d+(?:\.\d+)?)\s*(ms|s)\b/i

/**
 * How long a 429 asks us to wait, in ms: the `retry-after-ms` or `retry-after`
 * header, else OpenAI's "Please try again in 12s" in the message. `undefined`
 * when neither says.
 */
export function rateLimitDelayMs(error: unknown): number | undefined {
  const cause = RetryError.isInstance(error) ? error.lastError : error
  if (!APICallError.isInstance(cause)) return undefined

  const headers = cause.responseHeaders ?? {}
  const ms = Number.parseFloat(headers['retry-after-ms'] ?? '')
  if (Number.isFinite(ms) && ms >= 0) return ms
  const retryAfter = headers['retry-after']
  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
    const until = Date.parse(retryAfter) - Date.now()
    if (Number.isFinite(until)) return Math.max(0, until)
  }

  const match = TRY_AGAIN_IN.exec(cause.message)
  if (match) return Number.parseFloat(match[1]!) * (match[2]!.toLowerCase() === 'ms' ? 1 : 1000)
  return undefined
}

/**
 * OpenAI answers an exhausted quota or billing limit with a 429 as well
 * (`insufficient_quota`). No wait clears it, so it is not a rate limit.
 */
export function isQuotaExhausted(error: unknown): boolean {
  const cause = RetryError.isInstance(error) ? error.lastError : error
  return APICallError.isInstance(cause) && /insufficient_quota/.test(cause.responseBody ?? '')
}

/** A 429 that waiting clears: the per-minute rate limit (HON-742). */
export const isRateLimited = (error: unknown): boolean =>
  aiErrorStatusCode(error) === 429 && !isQuotaExhausted(error)

const isRetryable = (error: unknown) => APICallError.isInstance(error) && error.isRetryable

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export class MealImageUnavailableError extends Error {
  constructor() {
    super('OPENAI_API_KEY is not set')
    this.name = 'MealImageUnavailableError'
  }
}

/** One billed call, reported as it completes so a later failure cannot lose it. */
export interface MealImageUsage extends AiUsageStats {
  /** Recorded instead of `$0` when an image result carries no token usage. */
  fallbackCostUsd?: number
}

export interface GenerateMealImageOptions {
  abortSignal?: AbortSignal
  /** The wall-clock budget `abortSignal` enforces, in ms. Gates the regeneration. */
  budgetMs?: number
  onUsage?: (usage: MealImageUsage) => void | Promise<void>
  /** For log lines only. */
  mealId?: string
  /**
   * `gate` (default): judge, and regenerate once on a serious finding — the
   * unattended route. `report`: judge once, never regenerate — the operator
   * batch (HON-738), where a human reviews every image. `off`: no judge call.
   */
  judge?: 'gate' | 'report' | 'off'
  /**
   * Retries of a rate-limited (429) first image, each after the wait the
   * response names or the next `RATE_LIMIT_BACKOFF_MS` step. Default 3.
   */
  rateLimitRetries?: number
  /** A 429 asking for a longer wait than this is given up on at once. */
  maxRateLimitWaitMs?: number
  /**
   * Classify the vessel and scale the footprint to its target width
   * (HON-1024). Default true; `false` returns the image as drawn, for a spike
   * that wants to see the raw output.
   */
  fit?: boolean
}

export interface GeneratedMealImage {
  bytes: Uint8Array
  mediaType: string
  /** Images generated: 1, or 2 after a regeneration. */
  attempts: number
  /** Images, judge calls and the vessel call together, in USD. */
  totalUsd: number
  /** The judge's verdict on the returned image; `null` when not judged or the judge call failed. */
  verdict: JudgeVerdict | null
  /** The vessel the returned image serves its food in and its size; `null` when not classified or the call failed. */
  vessel: VesselEstimate | null
  /** What `fitFootprint` did to the returned image; `null` when it was not run or failed. */
  fit: FootprintFit | null
}

export interface ClassifyVesselOptions {
  abortSignal?: AbortSignal
  onUsage?: (usage: MealImageUsage) => void | Promise<void>
  /** For log lines only. */
  mealId?: string
}

/**
 * Which vessel the image serves its food in and how wide it is in life, by
 * one short `REVIEW_MODEL` vision call (HON-1024). `null` when the call
 * failed, timed out, named nothing known or gave a size no dishware comes
 * in: the image is kept as drawn either way, so this never throws.
 * Shared with the backfill (`scripts/refit-meal-images.ts`).
 */
export async function classifyVessel(
  image: { bytes: Uint8Array; mediaType: string },
  options: ClassifyVesselOptions = {},
): Promise<VesselEstimate | null> {
  const { abortSignal, mealId } = options
  const report = async (usage: MealImageUsage) => {
    await options.onUsage?.(usage)
  }
  try {
    const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })
    const startedAt = Date.now()
    const result = await withUsageOnFailure(REVIEW_MODEL, report, () =>
      generateObject({
        model: anthropic(REVIEW_MODEL),
        schema: vesselSchema,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'file', data: image.bytes, mediaType: image.mediaType },
              { type: 'text', text: VESSEL_PROMPT },
            ],
          },
        ],
        maxOutputTokens: 200,
        maxRetries: 2,
        abortSignal,
      }),
    )
    await report(toAiUsageStats(REVIEW_MODEL, result.usage, Date.now() - startedAt))
    const vessel = asVesselEstimate(result.object)
    if (!vessel) {
      // eslint-disable-next-line no-console
      console.warn(
        `[meal-image] vessel call for meal ${mealId} named nothing known; keeping the image as drawn`,
      )
    }
    return vessel
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      `[meal-image] vessel call failed for meal ${mealId}; keeping the image as drawn`,
      error,
    )
    return null
  }
}

function imageUsageStats(usage: ImageModelUsage | undefined, durationMs: number): MealImageUsage {
  const input = usage?.inputTokens
  const output = usage?.outputTokens
  const usageMissing = typeof output !== 'number' || !Number.isFinite(output)
  return {
    model: MEAL_IMAGE_MODEL,
    inputTokens: typeof input === 'number' && Number.isFinite(input) ? input : 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: usageMissing ? 0 : output,
    usageMissing,
    durationMs,
    ...(usageMissing && { fallbackCostUsd: IMAGE_FALLBACK_USD }),
  }
}

function costOf(usage: MealImageUsage): number {
  if (usage.usageMissing && usage.fallbackCostUsd !== undefined) return usage.fallbackCostUsd
  return estimateCostUsd(usage)
}

export async function generateMealImage(
  meal: MealImageMeal,
  options: GenerateMealImageOptions = {},
): Promise<GeneratedMealImage> {
  const apiKey = serverEnv.OPENAI_API_KEY
  if (!apiKey) throw new MealImageUnavailableError()

  const {
    abortSignal,
    budgetMs,
    mealId,
    judge: judgeMode = 'gate',
    rateLimitRetries = RATE_LIMIT_BACKOFF_MS.length,
    maxRateLimitWaitMs = Infinity,
  } = options
  const openai = createOpenAI({ apiKey })
  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })
  const prompt = buildMealImagePrompt(meal)
  const startedAt = Date.now()
  let totalUsd = 0

  const report = async (usage: MealImageUsage) => {
    totalUsd += costOf(usage)
    await options.onUsage?.(usage)
  }

  const remainingMs = () =>
    budgetMs === undefined ? Infinity : budgetMs - (Date.now() - startedAt)

  const callImage = () =>
    generateImage({
      model: openai.image(MEAL_IMAGE_MODEL),
      prompt,
      size: '1536x1024',
      // `max` costs ~4× and a dialog hero won't show the difference (HON-717).
      providerOptions: { openai: { quality: 'high', outputFormat: 'png' } },
      // Retries are ours, below: the SDK would retry a 429 on its own ~2 s
      // schedule (or a `retry-after` under 60 s) outside the caller's budget.
      maxRetries: 0,
      abortSignal,
    })

  /**
   * One image, retried here. A 429 waits for the window to clear, up to
   * `allowedRateLimitRetries` times (HON-742); any other retryable error is
   * retried once after `TRANSIENT_RETRY_MS`, as the SDK did before.
   */
  const draw = async (allowedRateLimitRetries: number) => {
    let rateLimited = 0
    let transient = 0
    for (;;) {
      try {
        const callStartedAt = Date.now()
        const result = await callImage()
        await report(imageUsageStats(result.usage, Date.now() - callStartedAt))
        return { bytes: result.image.uint8Array, mediaType: result.image.mediaType }
      } catch (error) {
        if (isRateLimited(error)) {
          if (rateLimited >= allowedRateLimitRetries) throw error
          const wait =
            rateLimitDelayMs(error) ??
            RATE_LIMIT_BACKOFF_MS[Math.min(rateLimited, RATE_LIMIT_BACKOFF_MS.length - 1)]!
          // An image started after the wait must still fit the caller's budget.
          if (wait > maxRateLimitWaitMs || remainingMs() - wait < RETRY_MIN_REMAINING_MS) {
            throw error
          }
          rateLimited += 1
          // eslint-disable-next-line no-console
          console.warn(
            `[meal-image] rate-limited for meal ${mealId}; retry ${rateLimited}/${allowedRateLimitRetries} in ${Math.round(wait / 1000)} s`,
          )
          await sleep(wait, abortSignal)
          continue
        }
        if (isRetryable(error) && !isQuotaExhausted(error) && transient === 0) {
          transient += 1
          await sleep(TRANSIENT_RETRY_MS, abortSignal)
          continue
        }
        throw error
      }
    }
  }

  /** `null` when the judge call itself failed or timed out: that costs the verdict, not the image. */
  const judge = async (
    image: { bytes: Uint8Array; mediaType: string },
    attempt: number,
  ): Promise<JudgeVerdict | null> => {
    try {
      const judgeStartedAt = Date.now()
      const result = await withUsageOnFailure(REVIEW_MODEL, report, () =>
        generateObject({
          model: anthropic(REVIEW_MODEL),
          schema: judgeV2Schema,
          messages: [
            {
              role: 'user',
              content: [
                // A `file` part — ai@7 deprecates the `image` content part.
                { type: 'file', data: image.bytes, mediaType: image.mediaType },
                { type: 'text', text: buildJudgeV2Prompt(meal) },
              ],
            },
          ],
          maxOutputTokens: 2000,
          maxRetries: 2,
          abortSignal,
        }),
      )
      await report(toAiUsageStats(REVIEW_MODEL, result.usage, Date.now() - judgeStartedAt))
      const verdict = applyJudgeFilters(result.object, meal)
      // Raw and filtered both, so a filter that hid a real extra can be found later.
      // eslint-disable-next-line no-console
      console.info(
        '[meal-image] judge',
        JSON.stringify({
          mealId,
          attempt,
          pass: verdict.pass,
          strictPass: verdict.strictPass,
          raw: verdict.raw,
          filtered: verdict.filtered,
        }),
      )
      return verdict
    } catch (error) {
      // A timeout included: the image is already paid for and most likely fine,
      // so running out of budget on its verdict must not throw it away.
      // eslint-disable-next-line no-console
      console.warn(`[meal-image] judge failed for meal ${mealId}; keeping the image`, error)
      return null
    }
  }

  /** The vessel, or null without a fit: never a throw, as with the judge. */
  const classify = (image: {
    bytes: Uint8Array
    mediaType: string
  }): Promise<VesselEstimate | null> =>
    options.fit === false
      ? Promise.resolve(null)
      : classifyVessel(image, { abortSignal, onUsage: report, mealId })

  /**
   * The kept image at its vessel's width (HON-1024). A failure here is logged
   * and the image returned as drawn: it is paid for, and a plate 5% too wide
   * is better than no plate.
   */
  const fitted = async (
    image: { bytes: Uint8Array; mediaType: string },
    vessel: VesselEstimate | null,
  ): Promise<Pick<GeneratedMealImage, 'bytes' | 'mediaType' | 'vessel' | 'fit'>> => {
    if (!vessel) return { ...image, vessel, fit: null }
    try {
      const result = await fitFootprint(image.bytes, image.mediaType, vessel)
      // eslint-disable-next-line no-console
      console.info('[meal-image] fit', JSON.stringify({ mealId, ...result.fit }))
      return { bytes: result.bytes, mediaType: result.mediaType, vessel, fit: result.fit }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[meal-image] fit failed for meal ${mealId}; keeping the image as drawn`, error)
      return { ...image, vessel, fit: null }
    }
  }

  let image = await draw(rateLimitRetries)
  let attempts = 1
  if (judgeMode === 'off') {
    const vessel = await classify(image)
    return { ...(await fitted(image, vessel)), attempts, totalUsd, verdict: null }
  }

  // The vessel call runs beside the judge, so it adds no time to the request.
  const [first, firstVessel] = await Promise.all([judge(image, attempts), classify(image)])
  let verdict = first
  let vessel = firstVessel

  if (judgeMode === 'gate' && first && !first.pass) {
    const remaining = remainingMs()
    if (remaining < RETRY_MIN_REMAINING_MS) {
      // eslint-disable-next-line no-console
      console.warn(
        `[meal-image] serious judge finding for meal ${mealId}, but only ${remaining} ms left; keeping the first image`,
      )
    } else {
      try {
        // No waiting out a 429 here: the first image is paid for and kept.
        const second = await draw(0)
        image = second
        attempts = 2
        // The second image is a new drawing, so it is classified afresh.
        ;[verdict, vessel] = await Promise.all([judge(second, attempts), classify(second)])
        if (verdict && !verdict.pass) {
          // 0 of 36 spike images had a real serious finding, so a second fail is
          // most likely a judge false positive. Keep it rather than show nothing.
          // eslint-disable-next-line no-console
          console.warn(
            `[meal-image] regenerated image for meal ${mealId} also failed the judge; keeping it`,
          )
        }
      } catch (error) {
        // The first image is paid for and most likely fine, so no failure of
        // the retry — a budget overrun (the gate above only guarantees room at
        // the start), a 429, a content-policy refusal — may cost the meal it.
        // eslint-disable-next-line no-console
        console.warn(
          `[meal-image] regeneration for meal ${mealId} failed; keeping the first image`,
          error,
        )
      }
    }
  }

  return { ...(await fitted(image, vessel)), attempts, totalUsd, verdict }
}
