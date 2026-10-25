import 'server-only'
import { prisma } from '@/lib/prisma'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { toDateString } from '@/lib/meal-planning/dates'
import { parseCachedPreparationSteps } from '@/lib/preparation-steps'
import { getEffectiveServings, sumPortions } from '@/lib/meal-planning/servings'
import { applyEntryChanges, staleChangeIds } from '@/lib/meal-planning/entry-components'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'
import type { MealPlanEntryStatus } from '@/generated/prisma/enums'
import { presentMealImage } from '@/lib/meal-images/present'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import {
  findPreferenceConflicts,
  type ConflictPreferences,
  type PreferenceConflict,
} from '@/lib/meal-planning/preference-conflicts'

export interface PlanEntriesHousehold {
  id: string
  locale: string
  /** Read with `members` to tell which cached tips still fit (`parseCachedPreparationSteps`). */
  _count: { members: number }
  members: readonly { preferences: { portionMultiplier: number } | null }[]
  /**
   * The household's food preferences, which mark the planned meals that break
   * them (HON-1126). Absent or null marks none.
   */
  preferences?: ConflictPreferences | null
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
      // The entry's own ingredient changes (HON-1243), oldest first, merged
      // over the meal's components below.
      changes: {
        orderBy: { createdAt: 'asc' },
        include: {
          originalIngredient: { include: ingredientTranslationsInclude(locale) },
          replacementIngredient: { include: ingredientTranslationsInclude(locale) },
        },
      },
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
      // A fridge meal's items (HON-1277), with what each shows by.
      items: {
        orderBy: { position: 'asc' },
        include: {
          ingredient: { select: { name: true, ...ingredientTranslationsInclude(locale) } },
          sourceEntry: {
            select: {
              date: true,
              meal: { select: { name: true, ...mealTranslationsInclude(locale) } },
            },
          },
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
    // What this entry cooks: the meal's components with the entry's changes
    // merged. Nutrition, the conflicts, the availability the client computes
    // and every quantity shown read this list, never the bare meal.
    const mealComponents = entry.meal?.components ?? []
    const components = applyEntryChanges(mealComponents, entry.changes)
    const stale = staleChangeIds(mealComponents, entry.changes)
    // Planned meals only: a cooked or skipped meal is history. Canonical names,
    // not the translated ones: the keyword lists match both languages.
    const conflicts: PreferenceConflict[] =
      entry.meal && entry.status === 'planned' && household.preferences
        ? findPreferenceConflicts({ ...entry.meal, components }, household.preferences)
        : []

    return {
      id: entry.id,
      date: toDateString(entry.date),
      mealType: entry.mealType,
      status: entry.status,
      kind: entry.kind,
      items: entry.items.map((item) => ({
        id: item.id,
        ingredientId: item.ingredientId,
        sourceEntryId: item.sourceEntryId,
        label: item.label,
        // The ingredient's or the source meal's name. Null for free text, and
        // for a source entry that has lost its meal since.
        name: item.ingredient
          ? translateIngredient(item.ingredient, locale).name
          : item.sourceEntry?.meal
            ? translateMeal(item.sourceEntry.meal, locale).name
            : null,
        sourceDate: item.sourceEntry ? toDateString(item.sourceEntry.date) : null,
      })),
      rating: entry.rating,
      // Tips priced at other servings are dropped here as the tips route drops
      // them, so the cook view asks for fresh ones instead of showing these.
      preparationTips: entry.preparationTips
        ? parseCachedPreparationSteps(entry.preparationTips, {
            servings: getEffectiveServings(entry, householdServings),
            legacyServings: entry.servingOverride ?? household._count.members,
          })
        : null,
      note: entry.note,
      noteX: entry.noteX,
      noteY: entry.noteY,
      servingOverride: entry.servingOverride,
      pantryDeducted: entry.pantryDeductedAt !== null,
      conflicts,
      adjustmentNote: entry.adjustmentNote,
      changes: entry.changes.map((change) => ({
        id: change.id,
        original: change.originalIngredient && {
          id: change.originalIngredient.id,
          name: translateIngredient(change.originalIngredient, locale).name,
        },
        replacement: change.replacementIngredient && {
          id: change.replacementIngredient.id,
          name: translateIngredient(change.replacementIngredient, locale).name,
        },
        quantityPerServing: change.quantityPerServing,
        stale: stale.has(change.id),
      })),
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
              nutrition: computeMealNutrition(components),
              components: components.map((comp) => ({
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
                  measuredByVolume: comp.ingredient.measuredByVolume,
                  pieceDisplay: comp.ingredient.pieceDisplay,
                  gramsPerPiece: comp.ingredient.gramsPerPiece,
                },
              })),
            }
          : null,
    }
  })

  return { entries: formattedEntries, planId: plan.id }
}
