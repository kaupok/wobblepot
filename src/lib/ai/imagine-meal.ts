import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { serverEnv } from '@/lib/env'
import { IMAGINE_MODEL } from './models'
import { buildImagineRequest, type HouseholdContext, type ImaginedMeal } from './imagine-request'
import { logAiSample } from './sampling'
import { toAiUsageStats, withUsageOnFailure, type AiUsageStats } from './usage'

export {
  ImaginedMealsSchema,
  type HouseholdContext,
  type ImaginedIngredient,
  type ImaginedMeal,
} from './imagine-request'

/**
 * Generate three meal suggestions from a prompt and/or attached photos.
 *
 * `abortSignal` is the wall-clock budget for the AI call, owned by
 * `/api/meals/imagine`. It is a trailing positional parameter rather than an
 * options object only because this signature already is one — see the plan on
 * HON-694. Undefined leaves the call unbounded, which is the pre-HON-694
 * behaviour and what the tests rely on.
 */
export async function imagineMeals(
  prompt: string | null,
  household: HouseholdContext,
  locale: string,
  images?: { base64: string; mimeType: string }[],
  onAiUsage?: (usage: AiUsageStats) => void,
  abortSignal?: AbortSignal,
): Promise<ImaginedMeal[]> {
  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })

  const request = buildImagineRequest({ prompt, household, locale, images })

  const result = await withUsageOnFailure(IMAGINE_MODEL, onAiUsage, () =>
    generateObject({
      ...request,
      model: anthropic(IMAGINE_MODEL),
      // Wall-clock budget owned by `/api/meals/imagine` — shared by this
      // attempt and every retry, not a per-attempt timeout.
      abortSignal,
    }),
  )

  onAiUsage?.(toAiUsageStats(IMAGINE_MODEL, result.usage))

  await logAiSample({
    callSite: 'imagine-meal',
    locale,
    input: {
      prompt,
      hasImages: Boolean(images?.length),
      dietaryType: household.dietaryType,
      allergens: household.allergens,
      excludedIngredients: household.excludedIngredients,
      restrictions: household.restrictions,
      householdSize: household.householdSize,
    },
    output: result.object,
  })

  return result.object.meals
}
