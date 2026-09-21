import 'server-only'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { generateImage, generateObject, type ImageModelUsage } from 'ai'
import { MEAL_IMAGE_MODEL, REVIEW_MODEL } from '@/lib/ai/models'
import { estimateCostUsd } from '@/lib/ai/pricing'
import { isAiBudgetTimeout } from '@/lib/ai/timeout'
import { toAiUsageStats, withUsageOnFailure, type AiUsageStats } from '@/lib/ai/usage'
import { serverEnv } from '@/lib/env'
import { applyJudgeFilters, buildJudgeV2Prompt, judgeV2Schema, type JudgeVerdict } from './judge'
import { buildMealImagePrompt, type MealImageMeal } from './prompt'

/**
 * Generate a meal illustration with the HON-726 recipe: one image, one vision
 * judge, and at most one regeneration when the judge finds something serious
 * (an added ingredient, or props and cookware beside the dish).
 */

/** Flat price for an image whose result carries no token usage — the spike's `estPerImageUsd`. */
export const IMAGE_FALLBACK_USD = 0.05

/**
 * A regeneration is only started with this much of the caller's budget left:
 * one image (~18 s measured) plus its judge (~3.4 s), with headroom. Starting
 * one that cannot finish would turn a usable first image into a timeout.
 */
export const RETRY_MIN_REMAINING_MS = 25_000

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
}

export interface GeneratedMealImage {
  bytes: Uint8Array
  mediaType: string
  /** Images generated: 1, or 2 after a regeneration. */
  attempts: number
  /** Images and judge calls together, in USD. */
  totalUsd: number
}

function imageUsageStats(usage: ImageModelUsage | undefined): MealImageUsage {
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

  const { abortSignal, budgetMs, mealId } = options
  const openai = createOpenAI({ apiKey })
  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })
  const prompt = buildMealImagePrompt(meal)
  const startedAt = Date.now()
  let totalUsd = 0

  const report = async (usage: MealImageUsage) => {
    totalUsd += costOf(usage)
    await options.onUsage?.(usage)
  }

  const draw = async () => {
    const result = await generateImage({
      model: openai.image(MEAL_IMAGE_MODEL),
      prompt,
      size: '1536x1024',
      // `max` costs ~4× and a dialog hero won't show the difference (HON-717).
      providerOptions: { openai: { quality: 'high', outputFormat: 'png' } },
      maxRetries: 1,
      abortSignal,
    })
    await report(imageUsageStats(result.usage))
    return { bytes: result.image.uint8Array, mediaType: result.image.mediaType }
  }

  /** `null` when the judge call itself failed or timed out: that costs the verdict, not the image. */
  const judge = async (
    image: { bytes: Uint8Array; mediaType: string },
    attempt: number,
  ): Promise<JudgeVerdict | null> => {
    try {
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
      await report(toAiUsageStats(REVIEW_MODEL, result.usage))
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

  let image = await draw()
  let attempts = 1
  const first = await judge(image, attempts)

  if (first && !first.pass) {
    const remaining = budgetMs === undefined ? Infinity : budgetMs - (Date.now() - startedAt)
    if (remaining < RETRY_MIN_REMAINING_MS) {
      // eslint-disable-next-line no-console
      console.warn(
        `[meal-image] serious judge finding for meal ${mealId}, but only ${remaining} ms left; keeping the first image`,
      )
    } else {
      try {
        const second = await draw()
        image = second
        attempts = 2
        const verdict = await judge(second, attempts)
        if (verdict && !verdict.pass) {
          // 0 of 36 spike images had a real serious finding, so a second fail is
          // most likely a judge false positive. Keep it rather than show nothing.
          // eslint-disable-next-line no-console
          console.warn(
            `[meal-image] regenerated image for meal ${mealId} also failed the judge; keeping it`,
          )
        }
      } catch (error) {
        // The gate above only guarantees room at the start: a retried draw can
        // still overrun. The first image is paid for, so keep it over a 504.
        if (!isAiBudgetTimeout(error)) throw error
        // eslint-disable-next-line no-console
        console.warn(
          `[meal-image] regeneration for meal ${mealId} ran out of budget; keeping the first image`,
        )
      }
    }
  }

  return { ...image, attempts, totalUsd }
}
