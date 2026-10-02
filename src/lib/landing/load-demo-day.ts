import 'server-only'
import type { MealType } from '@/generated/prisma/enums'
import type { MealData, StructuredTips } from '@/components/meal-plan/types'
import { prisma } from '@/lib/prisma'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { parseStoredTips } from '@/lib/tips'
import { presentMealImage } from '@/lib/meal-images/present'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales'

/**
 * The calendar whose day picks the trio. One timezone for every visitor, so
 * the three meals change once a day for everyone rather than per browser; the
 * first cohort's, so the change lands overnight for them.
 */
export const DEMO_TIMEZONE = 'Europe/Tallinn'

/** The slots the demo fills, in the order the day shows them. */
export const DEMO_MEAL_TYPES = [
  'breakfast',
  'lunch',
  'dinner',
] as const satisfies readonly MealType[]

export interface DemoMeal {
  mealType: MealType
  meal: MealData
  /** The library's steps for `servings`, from `MealPreparationSteps`. */
  steps: StructuredTips
  servings: number
}

export interface DemoDay {
  /** YYYY-MM-DD in `DEMO_TIMEZONE`: the day the trio was picked for. */
  date: string
  meals: DemoMeal[]
}

/** FNV-1a, so one date and slot always land on the same index. */
function hash(input: string): number {
  let h = 0x811c9dc5
  for (const char of input) {
    h ^= char.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/**
 * One meal per slot for `date`, from a pool, with no meal in two slots. The
 * pool is sorted by id first so the pick does not depend on query order, and
 * each slot hashes the date and its own name, so a day's breakfast and dinner
 * move independently. Null when any slot has no candidate.
 */
export function pickDemoMeals<T extends { id: string; suitableFor: MealType[] }>(
  pool: readonly T[],
  date: string,
): Map<MealType, T> | null {
  const sorted = [...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const picked = new Map<MealType, T>()
  for (const mealType of DEMO_MEAL_TYPES) {
    const taken = new Set([...picked.values()].map((meal) => meal.id))
    const candidates = sorted.filter(
      (meal) => meal.suitableFor.includes(mealType) && !taken.has(meal.id),
    )
    const choice = candidates[hash(`${date}:${mealType}`) % candidates.length]
    if (!choice) return null
    picked.set(mealType, choice)
  }
  return picked
}

/**
 * Today's three meals for the signed-out home page: library meals with a
 * ready illustration and steps written ahead of time (`pnpm steps:library`,
 * which the deploy workflows run), so the page never calls the AI. Steps in the
 * visitor's locale, else the English ones; a row older than the meal's last
 * edit is stale and leaves the meal out. Null when a slot cannot be filled,
 * and the page shows its static example instead.
 */
export async function loadDemoDay({
  locale,
  date,
}: {
  locale: Locale
  date: string
}): Promise<DemoDay | null> {
  const locales = locale === DEFAULT_LOCALE ? [DEFAULT_LOCALE] : [locale, DEFAULT_LOCALE]

  const meals = await prisma.meal.findMany({
    where: {
      householdId: null,
      deletedAt: null,
      imageStatus: 'ready',
      imageHue: { not: null },
      preparationSteps: { some: { locale: { in: locales } } },
    },
    include: {
      components: {
        include: { ingredient: { include: ingredientTranslationsInclude(locale) } },
      },
      ...mealTranslationsInclude(locale),
      preparationSteps: { where: { locale: { in: locales } } },
    },
  })

  const prepared = meals.flatMap((meal) => {
    const image = presentMealImage(meal)
    if (image.imageStatus !== 'ready') return []
    const fresh = meal.preparationSteps.filter(
      (row) => row.mealUpdatedAt.getTime() === meal.updatedAt.getTime(),
    )
    const row =
      fresh.find((candidate) => candidate.locale === locale) ??
      fresh.find((candidate) => candidate.locale === DEFAULT_LOCALE)
    if (!row) return []
    const steps = parseStoredTips(row.steps)
    if (!steps) return []
    return [
      { id: meal.id, suitableFor: meal.suitableFor, meal, image, steps, servings: row.servings },
    ]
  })

  const picked = pickDemoMeals(prepared, date)
  if (!picked) return null

  return {
    date,
    meals: DEMO_MEAL_TYPES.flatMap((mealType) => {
      const entry = picked.get(mealType)
      if (!entry) return []
      const { meal, image, steps, servings } = entry
      const translated = translateMeal(meal, locale)
      return [
        {
          mealType,
          steps,
          servings,
          meal: {
            id: meal.id,
            name: translated.name,
            description: translated.description ?? null,
            kidFriendly: meal.kidFriendly,
            timeMinutes: meal.timeMinutes,
            preparationNotes: translated.preparationNotes ?? null,
            primaryProteinType: meal.primaryProteinType,
            isCustom: false,
            ...image,
            nutrition: computeMealNutrition(meal.components),
            components: meal.components.map((comp) => ({
              ingredientId: comp.ingredientId,
              quantityPerServing: comp.quantityPerServing,
              isVague: comp.isVague,
              originalPhrase: comp.originalPhrase,
              ingredient: {
                id: comp.ingredient.id,
                name: translateIngredient(comp.ingredient, locale).name,
                category: comp.ingredient.category,
                defaultUnit: comp.ingredient.defaultUnit,
                gramsPerPiece: comp.ingredient.gramsPerPiece,
              },
            })),
          },
        },
      ]
    }),
  }
}
