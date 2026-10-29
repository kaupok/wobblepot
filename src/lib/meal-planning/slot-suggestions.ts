import 'server-only'

import type { AlternativeMeal } from '@/components/meal-plan/types'
import type { Allergen, DietaryType, MealType, ProteinType } from '@/generated/prisma/enums'
import { getExcludedIngredientIds } from '@/lib/household/excluded-ingredients'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'
import { presentMealImage } from '@/lib/meal-images/present'
import {
  randomScoreJitter,
  ratingSignal,
  scoreCandidate,
  SIMILARITY_WEIGHTS,
  SLOT_FIT_WEIGHTS,
} from '@/lib/meal-planning/candidate-score'
import {
  type CandidateFilters,
  type CandidateMeal,
  getCandidates,
} from '@/lib/meal-planning/candidates'
import { toDateString } from '@/lib/meal-planning/dates'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { getPantryIngredientNames } from '@/lib/meal-planning/pantry'
import { prisma } from '@/lib/prisma'

/**
 * Which list a slot gets, the same choice `use-meal-alternatives.ts` makes:
 * `swap` for an entry with a meal (`/regenerate`), `add` for an empty one
 * (`/suggestions`).
 *
 * - `swap` leaves the current meal out and ranks by closeness to it
 *   (`SIMILARITY_WEIGHTS`).
 * - `add` has no meal to compare against (`SLOT_FIT_WEIGHTS`).
 */
export type SlotSuggestionMode = 'swap' | 'add'

export interface SlotSuggestionHousehold {
  id: string
  preferences?: {
    dietaryType: DietaryType | null
    allergensToAvoid: Allergen[]
    excludedIngredients: string[]
  } | null
}

export interface SlotSuggestionEntry {
  id: string
  mealType: MealType
  mealId: string | null
  /** Read in `swap` mode only. */
  meal?: { timeMinutes: number | null; primaryProteinType: ProteinType } | null
}

/** How many suggestions a slot shows. */
const SUGGESTION_COUNT = 3

/**
 * Every meal the slot may take: the household's hard filters (dietary type,
 * allergens, excluded ingredients), and in `swap` mode not the meal already
 * there. A meal planned recently stays in, because a family plans from a
 * rotation of its usual meals on purpose (HON-1393). The suggestions are the
 * top of this pool, so a meal outside it is one they would never offer.
 *
 * No protein-type filter: generation places its fish and legume dinners by
 * position in a range that is not stored, so a slot cannot know whether it was
 * reserved for one (HON-892). In `swap` mode the replaced meal's protein type
 * is a ranking signal instead (`SIMILARITY_WEIGHTS.sameProteinType`).
 */
export async function loadSlotCandidates(
  household: SlotSuggestionHousehold,
  entry: SlotSuggestionEntry,
  mode: SlotSuggestionMode,
): Promise<CandidateMeal[]> {
  const preferences = household.preferences

  const favorites = await prisma.favoriteMeal.findMany({
    where: { householdId: household.id },
    select: { mealId: true },
  })

  const filters: CandidateFilters = {
    mealType: entry.mealType,
    allergensToAvoid: preferences?.allergensToAvoid ?? [],
    excludedIngredientIds: await getExcludedIngredientIds(
      household.id,
      preferences?.excludedIngredients ?? [],
    ),
    dietaryType: preferences?.dietaryType ?? null,
    householdId: household.id,
    favoriteMealIds: favorites.map((f) => f.mealId),
    includeNetRating: true,
  }

  const candidates = await getCandidates(filters)
  return mode === 'swap' ? candidates.filter((c) => c.id !== entry.mealId) : candidates
}

/**
 * The suggestions a slot shows: the top {@link SUGGESTION_COUNT} of
 * {@link loadSlotCandidates}, ranked by favourites, own recipes,
 * kid-friendliness, pantry overlap and the household's rating, in the
 * household's locale. Empty when no meal passes the filters.
 *
 * The jitter is a fresh per-request tie-break, so asking again for the same
 * slot can return a different top 3 (HON-709). See candidate-score.ts.
 */
export async function suggestForSlot(
  household: SlotSuggestionHousehold,
  entry: SlotSuggestionEntry,
  mode: SlotSuggestionMode,
  locale: string,
): Promise<AlternativeMeal[]> {
  const [candidates, pantryIngredients] = await Promise.all([
    loadSlotCandidates(household, entry, mode),
    getPantryIngredientNames(household.id),
  ])
  if (candidates.length === 0) return []
  const pantryIngredientNames = new Set(pantryIngredients)

  // `swap` compares prep time with the meal being replaced, so it needs every
  // candidate's time; `add` does not.
  const timeMap =
    mode === 'swap'
      ? new Map(
          (
            await prisma.meal.findMany({
              where: { id: { in: candidates.map((c) => c.id) } },
              select: { id: true, timeMinutes: true },
            })
          ).map((m) => [m.id, m.timeMinutes]),
        )
      : null

  const jitterDate = toDateString(new Date())
  const scored = candidates.map((candidate) => {
    const score = timeMap
      ? scoreCandidate(candidate, SIMILARITY_WEIGHTS, {
          timeMinutes: timeMap.get(candidate.id) ?? null,
          currentProteinType: entry.meal?.primaryProteinType ?? null,
          currentTimeMinutes: entry.meal?.timeMinutes ?? null,
          pantryIngredientNames,
        })
      : scoreCandidate(candidate, SLOT_FIT_WEIGHTS, { pantryIngredientNames })
    return {
      candidate,
      // The seed goes unused in production; it is passed so a test can
      // substitute the seeded `scoreJitter`.
      score:
        score +
        randomScoreJitter({ entryId: entry.id, dateString: jitterDate, candidateId: candidate.id }),
    }
  })
  scored.sort((a, b) => b.score - a.score)
  const selected = scored.slice(0, SUGGESTION_COUNT).map((s) => s.candidate)

  const mealDetails = await prisma.meal.findMany({
    where: { id: { in: selected.map((s) => s.id) } },
    include: {
      components: {
        include: {
          ingredient: {
            include: ingredientTranslationsInclude(locale),
          },
        },
      },
      ...mealTranslationsInclude(locale),
    },
  })
  const mealDetailsMap = new Map(mealDetails.map((m) => [m.id, m]))

  return selected.map((candidate) => {
    const mealDetail = mealDetailsMap.get(candidate.id)
    const translatedMeal = mealDetail ? translateMeal(mealDetail, locale) : null
    const components = mealDetail?.components ?? []

    return {
      id: candidate.id,
      name: translatedMeal?.name ?? candidate.name,
      description: translatedMeal?.description ?? null,
      timeMinutes: mealDetail?.timeMinutes ?? null,
      kidFriendly: candidate.kidFriendly,
      primaryProteinType: candidate.primaryProteinType,
      suitableFor: mealDetail?.suitableFor as MealType[] | undefined,
      isCustom: candidate.isCustom,
      // The cook view the card's name opens shows them (HON-1352).
      preparationNotes: translatedMeal?.preparationNotes ?? null,
      components: components.map((comp) => {
        const translatedIngredient = translateIngredient(comp.ingredient, locale)
        return {
          ingredientId: comp.ingredientId,
          quantityPerServing: comp.quantityPerServing,
          isVague: comp.isVague,
          originalPhrase: comp.originalPhrase,
          ingredient: {
            id: translatedIngredient.id,
            name: translatedIngredient.name,
            category: translatedIngredient.category,
            defaultUnit: translatedIngredient.defaultUnit as 'g' | 'piece',
            measuredByVolume: translatedIngredient.measuredByVolume,
            pieceDisplay: translatedIngredient.pieceDisplay,
            gramsPerPiece: translatedIngredient.gramsPerPiece,
          },
        }
      }),
      nutrition: computeMealNutrition(components),
      ratingSignal: ratingSignal(candidate.netRating),
      ...(mealDetail
        ? presentMealImage(mealDetail)
        : { imageUrl: null, imageStatus: undefined, imageHue: null }),
    }
  })
}
