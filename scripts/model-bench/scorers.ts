/**
 * Deterministic scorers for the model benchmark (HON-795).
 *
 * Schema validity is not scored here: `generateObject` throws
 * `NoObjectGeneratedError` on output the schema rejects, so an invalid output
 * reaches the report as an error, not as a score.
 *
 * Every scorer returns a flat record of metric values. Pass/fail checks are
 * `0` or `1` so a mean over cases reads as a rate. `null` means the metric does
 * not apply to this case (no seeded errors, no expected step count, …) and is
 * left out of the mean rather than counted as a zero.
 */

import type { z } from 'zod'
import { getDatesBetween, parseLocalDate } from '../../src/lib/meal-planning/dates'
import { computeMealSlots, computeRequiredSlots } from '../../src/lib/meal-planning/slots'
import type { MealSlot, SlotRequirement } from '../../src/lib/meal-planning/slots'
import type { CandidateMeal } from '../../src/lib/meal-planning/candidates'
import type { MealType } from '../../src/generated/prisma/enums'
import type { CandidatePools, HydratedPlanEntry, MealPlanResponse } from '../../src/lib/ai/types'
// `plan-helpers` also holds `hydratePlan`, so it imports `@/lib/prisma`, which
// builds a client at import time without connecting (it loads with an empty
// environment). Only the two pure validators below are called; never
// `hydratePlan` — plans are hydrated in memory from the case's pools.
import { validateAIResponseStructure, validateAndRepairPlan } from '../../src/lib/ai/plan-helpers'
import { validatePlan } from '../../src/lib/ai/validate-plan'
import { evaluateRecipeConfidence } from '../../src/lib/ai/recipe-confidence'
import type { RecipeExtraction } from '../../src/lib/ai/recipe-schema'
import type { ImaginedMealsSchema } from '../../src/lib/ai/imagine-request'
import {
  findUnexcusedKeyword,
  findViolations,
  normalizeFoodName,
  rulesForHousehold,
  type ForbiddenFoodRule,
} from '../../src/lib/ai/forbidden-foods'
import type { ReviewedIngredients } from '../../src/lib/ai/review-request'
import type { fullTipsSchema, supplementaryTipsSchema } from '../../src/lib/ai/preparation-tips'
import type {
  CookQuestionCase,
  ImagineCase,
  PlanCase,
  RecipeCase,
  ReviewCase,
  TipsCase,
} from './case-schema'

export type Scores = Record<string, number | null>

const pass = (ok: boolean) => (ok ? 1 : 0)

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

/** Everything plan generation derives from a case before the AI call. */
export interface PlanContext {
  startDate: Date
  endDate: Date
  slots: MealSlot[]
  requiredSlots: SlotRequirement[]
  candidatePools: CandidatePools
  candidatesByMealType: Map<MealType, CandidateMeal[]>
}

/**
 * Derive slots and required slots the way `generateMealPlan` does
 * (`src/lib/ai/generate-plan.ts`), so a change to the slot rules reaches the
 * benchmark. A case has no kept `completed` entries, so every configured slot
 * is replaceable.
 */
export function derivePlanContext(input: PlanCase): PlanContext {
  const startDate = parseLocalDate(input.startDate)
  const endDate = parseLocalDate(input.endDate)
  const dates = getDatesBetween(startDate, endDate)
  const slots = computeMealSlots(dates, input.weekdayMealTypes, input.weekendMealTypes)
  const requiredSlots = computeRequiredSlots({
    dietaryType: input.dietaryType,
    dates: slots.filter((s) => s.mealType === 'dinner').map((s) => s.date),
    weekdayMealTypes: input.weekdayMealTypes,
    weekendMealTypes: input.weekendMealTypes,
  })

  const candidatesByMealType = new Map(
    Object.entries(input.candidatesByMealType) as [MealType, CandidateMeal[]][],
  )

  // Same check `generateMealPlan` makes before the call. Here it means the case
  // itself is wrong, so fail loudly instead of scoring a request production
  // would never send.
  for (const slot of requiredSlots) {
    const pool =
      slot.proteinType === 'fish' ? input.candidatePools.fish : input.candidatePools.legume
    if (pool.length === 0) {
      throw new Error(
        `Case requires a ${slot.proteinType} dinner but its ${slot.proteinType} pool is empty`,
      )
    }
  }

  return {
    startDate,
    endDate,
    slots,
    requiredSlots,
    candidatePools: { ...input.candidatePools, byMealType: candidatesByMealType },
    candidatesByMealType,
  }
}

/**
 * Hydrate in memory from the case's own pools — never `hydratePlan`, which
 * reads Prisma. An ID missing from the pools is out of pool and hydrates to
 * `meal: null`, which `validatePlan` then reports as `invalid_meal`.
 */
export function scorePlan(ctx: PlanContext, output: MealPlanResponse): Scores {
  const pools = ctx.candidatePools
  const byId = new Map<string, CandidateMeal>()
  for (const meal of [
    ...pools.fish,
    ...pools.legume,
    ...pools.any,
    ...[...ctx.candidatesByMealType.values()].flat(),
  ]) {
    byId.set(meal.id, meal)
  }

  const outOfPoolIds = output.entries.filter((e) => !byId.has(e.mealId)).length

  let hydrated: HydratedPlanEntry[]
  try {
    hydrated = output.entries.map((e) => {
      const meal = byId.get(e.mealId)
      return {
        date: parseLocalDate(e.date),
        mealType: e.mealType,
        mealId: e.mealId,
        meal: meal
          ? {
              id: meal.id,
              name: meal.name,
              primaryProteinType: meal.primaryProteinType,
              kidFriendly: meal.kidFriendly,
            }
          : null,
      }
    })
  } catch {
    // An unparseable date: production's `hydratePlan` would throw the same way.
    return {
      structureValid: 0,
      firstTryValid: 0,
      validAfterRepair: 0,
      outOfPoolIds,
      dinnerProteinVariety: null,
    }
  }

  let structureValid = true
  try {
    validateAIResponseStructure(hydrated, ctx.slots)
  } catch {
    structureValid = false
  }

  const firstTryValid = structureValid && validatePlan(hydrated, ctx.requiredSlots).valid

  let validAfterRepair = false
  if (structureValid) {
    try {
      validateAndRepairPlan(hydrated, ctx.requiredSlots, ctx.candidatePools)
      validAfterRepair = true
    } catch {
      validAfterRepair = false
    }
  }

  const dinnerProteins = new Set(
    hydrated
      .filter((e) => e.mealType === 'dinner' && e.meal)
      .map((e) => e.meal!.primaryProteinType),
  )

  return {
    structureValid: pass(structureValid),
    firstTryValid: pass(firstTryValid),
    validAfterRepair: pass(validAfterRepair),
    outOfPoolIds,
    dinnerProteinVariety: dinnerProteins.size,
  }
}

// ---------------------------------------------------------------------------
// recipe
// ---------------------------------------------------------------------------

const normalize = (name: string) => name.trim().toLowerCase()

/** A line that starts a numbered step: `1. …`, `2) …`. */
const NUMBERED_LINE = /^\s*\d+[.)]\s/

export function countNumberedLines(text: string | null): number {
  if (!text) return 0
  return text.split('\n').filter((line) => NUMBERED_LINE.test(line)).length
}

/**
 * Recall and precision against the expected ingredients. Matching is one to
 * one: an output name matches when, lowercased and trimmed, it equals any alias
 * of an expected ingredient not already matched — so a duplicated ingredient
 * costs precision instead of matching twice.
 *
 * A not-a-recipe case expects no ingredients, so the three ingredient metrics
 * are `null` for it and only the confidence tier is scored.
 */
export function scoreRecipe(input: RecipeCase, output: RecipeExtraction): Scores {
  const expected = input.expected.ingredients
  const nothingExpected = expected.length === 0
  const unmatched = new Set(expected.map((_, i) => i))
  const pairs: { expectedIndex: number; outputIndex: number }[] = []

  output.ingredients.forEach((ing, outputIndex) => {
    const name = normalize(ing.name)
    for (const expectedIndex of unmatched) {
      if (expected[expectedIndex]!.names.some((alias) => normalize(alias) === name)) {
        pairs.push({ expectedIndex, outputIndex })
        unmatched.delete(expectedIndex)
        return
      }
    }
  })

  const matched = pairs.length
  const exactQuantities = pairs.filter(({ expectedIndex, outputIndex }) => {
    const want = expected[expectedIndex]!
    const got = output.ingredients[outputIndex]!
    return got.quantity === want.quantity && got.unit === want.unit
  }).length

  const tier = evaluateRecipeConfidence(output).tier
  const stepCount = input.expected.stepCount

  return {
    recall: nothingExpected ? null : matched / expected.length,
    precision: nothingExpected
      ? null
      : output.ingredients.length === 0
        ? 0
        : matched / output.ingredients.length,
    quantityUnitMatch: matched === 0 ? null : exactQuantities / matched,
    // `parseRecipeText` rejects only the `low` tier, so that is what
    // `expected.lowConfidence` predicts.
    confidenceAgrees: pass((tier === 'low') === input.expected.lowConfidence),
    // Reported, never a pass or fail: step granularity is a judgement call.
    stepCountDelta:
      stepCount === undefined ? null : countNumberedLines(output.preparationNotes) - stepCount,
  }
}

// ---------------------------------------------------------------------------
// imagine
// ---------------------------------------------------------------------------

/**
 * The rules `imagineMeals` applies (`src/lib/ai/forbidden-foods.ts`), so a
 * failure here on an allergen or diet means the production guard failed too
 * (HON-895). Ingredients only: this metric is "no forbidden ingredient", and
 * the guard's extra meal-name check is stricter, never looser. A case's own
 * `forbiddenKeywords` (excluded ingredients, foods the shared lists lack) are
 * one more rule, excused only by its own `allowedQualifiers`.
 */
export function imagineRules(input: ImagineCase): ForbiddenFoodRule[] {
  const rules = rulesForHousehold(input.household).map((r) => ({ ...r, checkMealName: false }))
  if (input.forbiddenKeywords?.length) {
    rules.push({
      constraint: 'case',
      kind: 'case',
      groups: [
        {
          keywords: input.forbiddenKeywords.map(normalizeFoodName),
          qualifiers: (input.allowedQualifiers ?? []).map(normalizeFoodName),
        },
      ],
      checkMealName: false,
    })
  }
  return rules
}

export function scoreImagine(
  input: ImagineCase,
  output: z.infer<typeof ImaginedMealsSchema>,
): Scores {
  const { meals } = output
  const rules = imagineRules(input)

  const exactlyThreeMeals = meals.length === 3
  const servingsMatch =
    meals.length > 0 && meals.every((m) => m.servings === input.household.householdSize)
  const minTwoIngredients = meals.length > 0 && meals.every((m) => m.ingredients.length >= 2)
  const noForbiddenIngredients = meals.every((m) => findViolations(m, rules).length === 0)

  return {
    allChecksPass: pass(
      exactlyThreeMeals && servingsMatch && minTwoIngredients && noForbiddenIngredients,
    ),
    exactlyThreeMeals: pass(exactlyThreeMeals),
    servingsMatch: pass(servingsMatch),
    minTwoIngredients: pass(minTwoIngredients),
    noForbiddenIngredients: pass(noForbiddenIngredients),
  }
}

// ---------------------------------------------------------------------------
// review
// ---------------------------------------------------------------------------

/** A seeded error with a single expected value counts as corrected within this fraction of it. */
export const REVIEW_CORRECTION_TOLERANCE = 0.25

export function scoreReview(input: ReviewCase, output: ReviewedIngredients): Scores {
  const counts = new Map<string, number>()
  const firstQuantity = new Map<string, number>()
  for (const ing of output.ingredients) {
    counts.set(ing.ingredientId, (counts.get(ing.ingredientId) ?? 0) + 1)
    if (!firstQuantity.has(ing.ingredientId))
      firstQuantity.set(ing.ingredientId, ing.quantityPerServing)
  }

  // Both ways: every input ID once, and no ID the input never had (HON-899),
  // which the review route would drop.
  const inputIds = new Set(input.ingredients.map((ing) => ing.ingredientId))
  const allIdsOnce =
    input.ingredients.every((ing) => counts.get(ing.ingredientId) === 1) &&
    [...counts.keys()].every((id) => inputIds.has(id))

  let seeded = 0
  let corrected = 0
  let unchanged = 0
  let kept = 0
  for (const ing of input.ingredients) {
    const expectation = input.expected[ing.ingredientId]
    if (!expectation) continue
    const got = firstQuantity.get(ing.ingredientId)

    if ('unchanged' in expectation) {
      unchanged++
      if (got === ing.quantityPerServing) kept++
    } else {
      seeded++
      if (got === undefined) continue
      const ok =
        'min' in expectation
          ? got >= expectation.min && got <= expectation.max
          : Math.abs(got - expectation.quantityPerServing) <=
            REVIEW_CORRECTION_TOLERANCE * expectation.quantityPerServing
      if (ok) corrected++
    }
  }

  return {
    allIdsOnce: pass(allIdsOnce),
    seededCorrected: seeded === 0 ? null : corrected / seeded,
    unchangedKept: unchanged === 0 ? null : kept / unchanged,
  }
}

// ---------------------------------------------------------------------------
// tips
// ---------------------------------------------------------------------------

/**
 * The item counts the tips prompts ask for. They exist only as `.describe()`
 * text on `fullTipsSchema` / `supplementaryTipsSchema` and in the prompt body
 * (`src/lib/ai/preparation-tips.ts`) — Anthropic's structured output cannot
 * enforce array lengths — so they are copied here. Update both together.
 */
export const TIPS_RANGES = {
  full: { equipment: [3, 5], steps: [4, 6], pitfalls: [2, 3] },
  supplementary: { pitfalls: [2, 3] },
} as const

const inRange = (n: number, [min, max]: readonly [number, number]) => n >= min && n <= max

export function scoreTips(
  input: TipsCase,
  output: z.infer<typeof fullTipsSchema> | z.infer<typeof supplementaryTipsSchema>,
): Scores {
  if (input.kind === 'full') {
    const full = output as z.infer<typeof fullTipsSchema>
    const r = TIPS_RANGES.full
    return {
      answered: 1,
      countsInRange: pass(
        inRange(full.equipment.length, r.equipment) &&
          inRange(full.steps.length, r.steps) &&
          inRange(full.pitfalls.length, r.pitfalls),
      ),
    }
  }

  const supplementary = output as z.infer<typeof supplementaryTipsSchema>
  return {
    answered: 1,
    countsInRange: pass(
      inRange(supplementary.pitfalls.length, TIPS_RANGES.supplementary.pitfalls) &&
        supplementary.tip.trim().length > 0,
    ),
  }
}

// ---------------------------------------------------------------------------
// cook-question
// ---------------------------------------------------------------------------

/**
 * Word ceilings for the answer. The off-topic one is from the first run
 * (HON-972): a decline ran 31 to 40 words because it offers help with the
 * step. The answer one is from HON-1003, after the prompt gained "never more
 * than 4" sentences and "under 80 words": over three runs of 24 on-topic
 * answers each, they measured 33 to 90 words, the longest an equipment
 * answer. So it fails an answer the cook cannot read at a glance, not a few
 * words over the prompt's 80.
 */
export const COOK_QUESTION_MAX_WORDS = { answer: 100, offTopic: 50 }

/** The prompt's "never more than 4" sentences (HON-1003). */
export const COOK_QUESTION_MAX_SENTENCES = 4

/**
 * An imperial unit right after a number: "350°F", "350F", "400 degrees
 * Fahrenheit", "2 cups", "8 oz", "a 12-inch pan". Anchored on the number, so "pound the chicken" and "a cup
 * of tea" never match, and "200 degrees" alone is read as Celsius.
 */
const IMPERIAL_UNIT =
  /\d\s*(?:°\s*f\b|f\b|degrees?\s+f(?:ahrenheit)?\b|fahrenheit|cups?\b|oz\b|ounces?\b|lbs?\b|pounds?\b|-?inch(?:es)?\b|fl\.?\s*oz)/iu

const wordCount = (text: string) => text.split(/\s+/u).filter(Boolean).length

/**
 * Sentences in a plain-text answer: a run of text ended by `.`, `!`, `?` or
 * `…` before whitespace and a capital letter or a digit, or by a line break,
 * so a second paragraph or a list line counts too. A decimal ("2.5 cm") or
 * "°C." mid-text does not split, since no whitespace follows the point. An
 * Estonian ordinal ("3. ja 4. sammus", "in steps 3 and 4") or an abbreviation
 * ("e.g. oat milk") does not split either, because a lowercase word follows.
 * Exported for tests.
 */
export function sentenceCount(text: string): number {
  return text
    .split(/(?<=[.!?…])\s+(?=[\p{Lu}\p{N}])|\n+/u)
    .filter((part) => /[\p{L}\p{N}]/u.test(part)).length
}

/**
 * Scores the plain-text answer. `answered` is always 1 here: an empty or
 * truncated answer is an error before it reaches the scorer, as production
 * shows the cook an error for it.
 */
export function scoreCookQuestion(input: CookQuestionCase, output: string): Scores {
  const { offTopic, mentionsAny, forbiddenKeywords, allowedQualifiers } = input.expected
  const text = normalizeFoodName(output)
  const words = wordCount(output)
  return {
    answered: 1,
    metricUnits: pass(!IMPERIAL_UNIT.test(output)),
    withinLength: offTopic ? null : pass(words <= COOK_QUESTION_MAX_WORDS.answer),
    withinSentences: offTopic ? null : pass(sentenceCount(output) <= COOK_QUESTION_MAX_SENTENCES),
    offTopicDeclined: offTopic ? pass(words <= COOK_QUESTION_MAX_WORDS.offTopic) : null,
    avoidsForbidden: forbiddenKeywords
      ? pass(
          findUnexcusedKeyword(
            text,
            forbiddenKeywords.map(normalizeFoodName),
            (allowedQualifiers ?? []).map(normalizeFoodName),
          ) === null,
        )
      : null,
    mentionsExpected: mentionsAny
      ? pass(mentionsAny.some((phrase) => text.includes(normalizeFoodName(phrase))))
      : null,
  }
}
