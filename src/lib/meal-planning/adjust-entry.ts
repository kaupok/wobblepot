import 'server-only'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { serverEnv } from '@/lib/env'
import { ADJUST_MODEL } from '@/lib/ai/models'
import { buildAdjustRecipeRequest, MAX_ADJUST_CHANGES } from '@/lib/ai/adjust-recipe'
import { matchIngredients } from '@/lib/ai/match-ingredients'
import { translateMatchResults } from '@/lib/ai/translate-match-results'
import {
  recordAiUsage,
  toAiUsageStats,
  withUsageOnFailure,
  type AiUsageStats,
} from '@/lib/ai/usage'
import { translateIngredient, translateMeal } from '@/lib/i18n/content'
import { MealPlanEntryStatus } from '@/generated/prisma/enums'
import {
  EntryContextError,
  loadEntryForAi,
  loadPantryNamesForAi,
} from '@/lib/meal-plans/entry-context'
import { staleChangeIds } from './entry-components'
import { getEffectiveServings, sumPortions } from './servings'
import {
  resolveChanges,
  type AdjustProposal,
  type AdjustReplacement,
  storableQuantity,
  type ResolvedChange,
} from './adjust-proposal'

/**
 * "Adjust recipe" (HON-1244): an instruction becomes proposed changes to one
 * planned entry. Nothing is written here: the household reviews the
 * proposals and applies them through `replaceEntryChanges`. The route owns
 * the session, the rate limit, the kill switch and the cost cap, so the MCP
 * tool can share this pipeline behind its own (HON-1246).
 */

/**
 * - `not_found`: no such entry in this household's plan.
 * - `no_meal`: an empty slot.
 * - `not_planned`: cooked or skipped, so its changes can no longer move.
 */
export type AdjustEntryRefusal = 'not_found' | 'no_meal' | 'not_planned'

export class AdjustEntryError extends Error {
  constructor(readonly reason: AdjustEntryRefusal) {
    super(`Adjust refused: ${reason}`)
    this.name = 'AdjustEntryError'
  }
}

/** The household, as `getHouseholdMembership` loads it. */
export interface AdjustHousehold {
  id: string
  members: readonly { preferences: { portionMultiplier: number } | null }[]
  preferences: {
    allergensToAvoid: unknown
    dietaryType: string | null
    excludedIngredients: string[]
    restrictions: string[]
  } | null
}

/** The entry an adjustment is for, read before the rate limit so a refusal costs nothing. */
export async function loadAdjustContext(
  householdId: string,
  planId: string,
  entryId: string,
  locale: string,
) {
  const entry = await loadEntryForAi(householdId, planId, entryId, locale).catch(
    (error: unknown) => {
      if (error instanceof EntryContextError) throw new AdjustEntryError('not_found')
      throw error
    },
  )
  const meal = entry.meal
  if (!meal) throw new AdjustEntryError('no_meal')
  if (entry.status !== MealPlanEntryStatus.planned) throw new AdjustEntryError('not_planned')
  return { ...entry, meal }
}

export type AdjustContext = Awaited<ReturnType<typeof loadAdjustContext>>

export interface AdjustResult {
  changes: AdjustProposal[]
  /** The steps should follow the instruction beyond the changes (see `adjustRecipeSchema`). */
  followInSteps: boolean
  /** The replacement names the catalogue did not match, in proposal order. */
  unmatched: string[]
}

/**
 * Asks the model for the changes, records the call's usage, resolves each
 * original against the merged components and matches each replacement to the
 * catalogue. A replacement the recipe or another proposal already brings in
 * is dropped, because the apply would refuse it.
 */
export async function proposeAdjustment(input: {
  household: AdjustHousehold
  context: AdjustContext
  instruction: string
  locale: string
  abortSignal: AbortSignal
}): Promise<AdjustResult> {
  const { household, context, instruction, locale, abortSignal } = input
  const components = context.components.map((comp) => ({
    ingredientId: comp.ingredientId,
    name: translateIngredient(comp.ingredient, locale).name,
    quantityPerServing: comp.quantityPerServing,
    defaultUnit: comp.ingredient.defaultUnit,
    measuredByVolume: comp.ingredient.measuredByVolume,
  }))
  const pantry = await loadPantryNamesForAi(household.id, locale)
  const preferences = household.preferences

  const request = buildAdjustRecipeRequest({
    mealName: translateMeal(context.meal, locale).name,
    servings: getEffectiveServings(context, sumPortions(household.members)),
    components,
    pantry: pantry.map((item) => ({
      name: translateIngredient(item.ingredient, locale).name,
      isStaple: item.isStaple,
    })),
    restrictions: {
      allergens: (preferences?.allergensToAvoid ?? []) as string[],
      dietaryType: preferences?.dietaryType ?? null,
      excludedIngredients: preferences?.excludedIngredients ?? [],
      restrictions: preferences?.restrictions ?? [],
    },
    instruction,
    locale,
  })

  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })
  const record = (stats: AiUsageStats) =>
    recordAiUsage({ householdId: household.id, feature: 'adjust_recipe', ...stats })
  const startedAt = Date.now()
  const result = await withUsageOnFailure(ADJUST_MODEL, record, () =>
    generateObject({ ...request, model: anthropic(ADJUST_MODEL), abortSignal }),
  )
  await record(toAiUsageStats(ADJUST_MODEL, result.usage, Date.now() - startedAt))

  const stale = staleChangeIds(context.meal.components, context.changes)
  const resolved = resolveChanges(
    result.object.changes.slice(0, MAX_ADJUST_CHANGES),
    components,
    context.changes.filter((c) => !stale.has(c.id)),
  )
  const replacements = await Promise.all(
    resolved.map((change) => matchReplacement(change, household.id, locale)),
  )

  // Ingredients the apply would refuse to bring in: the recipe's own (a
  // left-out one too, which comes back by Undo), and the merged list's.
  const taken = new Set([
    ...context.meal.components.map((c) => c.ingredientId),
    ...components.map((c) => c.ingredientId),
  ])
  const changes: AdjustProposal[] = []
  resolved.forEach((change, i) => {
    const replacement = replacements[i] ?? null
    if (replacement?.matched) {
      const id = replacement.ingredient.id
      // The ingredient it replaces: no change at all.
      if (id === change.original?.id) return
      // Back to the recipe's own ingredient is allowed: it undoes a change.
      if (id !== change.originalIngredientId && taken.has(id)) return
      taken.add(id)
    }
    changes.push({
      op: change.op,
      original: change.original,
      originalIngredientId: change.originalIngredientId,
      replacesChangeId: change.replacesChangeId,
      replacement,
      reason: change.reason,
    })
  })

  return {
    changes,
    followInSteps: result.object.followInSteps,
    unmatched: changes.flatMap((c) =>
      c.replacement && !c.replacement.matched ? [c.replacement.name] : [],
    ),
  }
}

/**
 * The catalogue match for one replacement, alone, so `matchIngredients`'
 * merge of duplicates cannot move a result onto another proposal. A
 * low-confidence match counts as none: a wrong ingredient would reach the
 * shopping list and the pantry deduction, so the household picks it.
 */
async function matchReplacement(
  change: ResolvedChange,
  householdId: string,
  locale: string,
): Promise<AdjustReplacement | null> {
  const wanted = change.replacement
  if (!wanted) return null
  const [match] = await translateMatchResults(
    await matchIngredients(
      [
        {
          name: wanted.name,
          quantity: wanted.quantity,
          unit: wanted.unit,
          originalText: wanted.name,
          isVague: false,
          vaguePhrase: null,
          isDried: null,
        },
      ],
      // One serving: the amount is already per serving.
      1,
      { householdId, locale },
    ),
    locale,
  )
  if (match?.type !== 'matched' || match.lowConfidence) {
    return { matched: false, name: wanted.name, quantity: wanted.quantity, unit: wanted.unit }
  }
  return {
    matched: true,
    ingredient: {
      id: match.ingredient.id,
      name: match.ingredient.name,
      defaultUnit: match.ingredient.defaultUnit,
      measuredByVolume: match.ingredient.measuredByVolume,
    },
    // In the ingredient's own unit now, so a piece count may round small.
    quantityPerServing: storableQuantity(match.convertedQuantity),
  }
}
