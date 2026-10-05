import 'server-only'
import { prisma } from '@/lib/prisma'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { toDateString } from '@/lib/meal-planning/dates'
import { parseCachedTips } from '@/lib/tips'
import { getEffectiveServings, sumPortions } from '@/lib/meal-planning/servings'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'
import type { MealPlanEntryStatus } from '@/generated/prisma/enums'
import { presentMealImage } from '@/lib/meal-images/present'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'

export interface PlanEntriesHousehold {
  id: string
  locale: string
  /** Read with `members` to tell which cached tips still fit (`parseCachedTips`). */
  _count: { members: number }
  members: readonly { preferences: { portionMultiplier: number } | null }[]
}

export interface PlanEntriesQuery {
  startDate: Date
  /** Exclusive. */
  endDate: Date
  status?: MealPlanEntryStatus
}

/**
 * The household's plan entries in `[startDate, endDate)`, in the shape
 * `GET /api/entries` returns. The route and the Today page both read through
 * this, so the server render and a client refetch cannot drift (HON-789).
 *
 * `planId` is null when the household has no plan yet, which is how Today tells
 * a first-time household from one with an empty window.
 */
export async function loadPlanEntries(household: PlanEntriesHousehold, query: PlanEntriesQuery) {
  // Translate seeded meal name/description into the household's locale so the
  // timeline renders Estonian (en is a no-op via isDefaultLocale). HON-547.
  // Resolved, so a locale rolled back out of KNOWN_LOCALES reads English (HON-921).
  const locale = resolveHouseholdLocale(household)

  // Find the household's single plan
  const plan = await prisma.mealPlan.findUnique({
    where: { householdId: household.id },
  })

  // No plan yet — new household, return empty
  if (!plan) {
    return { entries: [], planId: null }
  }

  const entries = await prisma.mealPlanEntry.findMany({
    where: {
      planId: plan.id,
      date: { gte: query.startDate, lt: query.endDate },
      ...(query.status ? { status: query.status } : {}),
    },
    include: {
      meal: {
        include: {
          components: {
            include: {
              ingredient: { include: ingredientTranslationsInclude(locale) },
            },
          },
          ...mealTranslationsInclude(locale),
        },
      },
    },
    orderBy: [{ date: 'asc' }, { mealType: 'asc' }],
  })

  const householdServings = sumPortions(household.members)

  const formattedEntries = entries.map((entry) => {
    // Coalesce the locale's MealTranslation over the canonical English fields
    // (per-field fallback). For en this returns the meal unchanged.
    const translatedMeal = entry.meal ? translateMeal(entry.meal, locale) : null

    return {
      id: entry.id,
      date: toDateString(entry.date),
      mealType: entry.mealType,
      status: entry.status,
      rating: entry.rating,
      // Tips priced at other servings are dropped here as the tips route drops
      // them, so the cook view asks for fresh ones instead of showing these.
      preparationTips: entry.preparationTips
        ? parseCachedTips(entry.preparationTips, {
            servings: getEffectiveServings(entry, householdServings),
            legacyServings: entry.servingOverride ?? household._count.members,
          })
        : null,
      note: entry.note,
      noteX: entry.noteX,
      noteY: entry.noteY,
      servingOverride: entry.servingOverride,
      pantryDeducted: entry.pantryDeductedAt !== null,
      meal:
        entry.meal && translatedMeal
          ? {
              id: entry.meal.id,
              name: translatedMeal.name,
              description: translatedMeal.description ?? null,
              kidFriendly: entry.meal.kidFriendly,
              timeMinutes: entry.meal.timeMinutes,
              preparationNotes: translatedMeal.preparationNotes ?? null,
              primaryProteinType: entry.meal.primaryProteinType,
              // The meal detail modal's hero illustration (HON-737). A global
              // meal is drawn by the operator batch, never lazily on open.
              isCustom: entry.meal.householdId !== null,
              // Card and hero tint (HON-744); null when the image has no colour.
              // A stale prompt version reads as no image, so it is redrawn (HON-753).
              ...presentMealImage(entry.meal),
              nutrition: computeMealNutrition(entry.meal.components),
              components: entry.meal.components.map((comp) => ({
                ingredientId: comp.ingredientId,
                quantityPerServing: comp.quantityPerServing,
                isVague: comp.isVague,
                originalPhrase: comp.originalPhrase,
                ingredient: {
                  id: comp.ingredient.id,
                  // Localize ingredient names too, so the timeline meal-detail
                  // doesn't mix an et title/description with en ingredients
                  // (HON-547 review). en is a no-op via isDefaultLocale.
                  name: translateIngredient(comp.ingredient, locale).name,
                  category: comp.ingredient.category,
                  defaultUnit: comp.ingredient.defaultUnit,
                  gramsPerPiece: comp.ingredient.gramsPerPiece,
                },
              })),
            }
          : null,
    }
  })

  return { entries: formattedEntries, planId: plan.id }
}
