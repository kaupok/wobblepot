import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { serverEnv } from '@/lib/env'
import { IMAGINE_MODEL } from './models'
import {
  buildImagineRequest,
  type HouseholdContext,
  type ImaginedMeal,
  type ImagineRequestInput,
} from './imagine-request'
import { partitionMeals, rulesForHousehold, type FoodViolation } from './forbidden-foods'
import { logAiSample } from './sampling'
import { toAiUsageStats, withUsageOnFailure, type AiUsageStats } from './usage'

export {
  ImaginedMealsSchema,
  type HouseholdContext,
  type ImaginedIngredient,
  type ImaginedMeal,
} from './imagine-request'

/** How many suggestions imagine asks for, and the most it returns. */
const MEAL_COUNT = 3

/** A suggestion the guard dropped, reported once per broken constraint. */
export interface ImagineConstraintViolation extends FoodViolation {
  model: string
  /** 1 for the first call, 2 for the retry. */
  attempt: 1 | 2
}

/**
 * Every suggestion broke a household allergen or diet, on the first call and
 * on the retry. The route answers 422 `imagine_no_safe_meals`.
 */
export class ImagineNoSafeMealsError extends Error {
  constructor() {
    super('Every imagined meal broke a household allergen or dietary constraint')
    this.name = 'ImagineNoSafeMealsError'
  }
}

/**
 * Generate three meal suggestions from a prompt and/or attached photos.
 *
 * `abortSignal` is the wall-clock budget for the AI call, owned by
 * `/api/meals/imagine`. It is a trailing positional parameter rather than an
 * options object only because this signature already is one — see the plan on
 * HON-694. Undefined leaves the call unbounded, which is the pre-HON-694
 * behaviour and what the tests rely on.
 *
 * The household's allergens and dietary type are in the prompt, but the
 * model does not always honour them when the user asks for the forbidden
 * food (HON-895). So every suggestion is checked against the shared keyword
 * lists in `./forbidden-foods`, and one that fails never reaches the caller.
 * If that leaves fewer than three, the call is retried once with the
 * violations named, within the same `abortSignal` budget. A failed retry
 * returns what the first call kept; no survivors at all throws
 * `ImagineNoSafeMealsError`.
 */
export async function imagineMeals(
  prompt: string | null,
  household: HouseholdContext,
  locale: string,
  images?: { base64: string; mimeType: string }[],
  onAiUsage?: (usage: AiUsageStats) => void,
  abortSignal?: AbortSignal,
  onConstraintViolation?: (violation: ImagineConstraintViolation) => void,
): Promise<ImaginedMeal[]> {
  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })
  const rules = rulesForHousehold(household)

  async function attempt(n: 1 | 2, previousViolations?: ImagineRequestInput['previousViolations']) {
    const request = buildImagineRequest({ prompt, household, locale, images, previousViolations })

    const startedAt = Date.now()

    const result = await withUsageOnFailure(IMAGINE_MODEL, onAiUsage, () =>
      generateObject({
        ...request,
        model: anthropic(IMAGINE_MODEL),
        // Wall-clock budget owned by `/api/meals/imagine` — shared by this
        // attempt and every retry, not a per-attempt timeout.
        abortSignal,
      }),
    )

    onAiUsage?.(toAiUsageStats(IMAGINE_MODEL, result.usage, Date.now() - startedAt))

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

    const { kept, dropped } = partitionMeals(result.object.meals, rules)
    for (const { violations } of dropped) {
      for (const violation of violations) {
        onConstraintViolation?.({ ...violation, model: IMAGINE_MODEL, attempt: n })
      }
    }
    return { kept, dropped }
  }

  const first = await attempt(1)
  if (first.dropped.length === 0 || first.kept.length >= MEAL_COUNT) return first.kept

  let retried: ImaginedMeal[]
  try {
    const second = await attempt(
      2,
      first.dropped.map(({ meal, violations }) => ({ meal: meal.name, violations })),
    )
    retried = second.kept
  } catch (error) {
    // The retry shares the route's budget, so a timeout here is likely. What
    // the first call kept is already checked and is a better answer than a 504.
    if (first.kept.length > 0) {
      console.warn('[imagine] retry after dropped meals failed; returning the first call’s', error)
      return first.kept
    }
    throw error
  }

  const seen = new Set(first.kept.map((m) => m.name.trim().toLowerCase()))
  const merged = [
    ...first.kept,
    ...retried.filter((m) => !seen.has(m.name.trim().toLowerCase())),
  ].slice(0, MEAL_COUNT)

  if (merged.length === 0) throw new ImagineNoSafeMealsError()
  return merged
}
