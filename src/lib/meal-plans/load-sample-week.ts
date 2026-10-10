import 'server-only'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { translateIngredient, translateMeal } from '@/lib/i18n/content'
import { DEFAULT_LOCALE } from '@/lib/i18n/locales'
import { presentMealImage } from '@/lib/meal-images/present'
import { parsePreparationSteps } from '@/lib/preparation-steps'
import { freshStepsRow } from '@/lib/landing/load-demo-day'
import type { SampleMealInput } from './build-sample-week'
import type { SampleWeek } from './sample-weeks'

/** The pages are English-only (HON-1073). */
const LOCALE = DEFAULT_LOCALE

/**
 * The week's meals from the global library, in the week's order, in English,
 * with each meal's fresh English steps when there is a fresh row (the check
 * `load-demo-day.ts` uses). A name with no library meal is left out rather
 * than failing the page; `sample-weeks.test.ts` keeps the names in step with
 * the seed. Exported for its test; the page reads `loadSampleWeek`.
 */
export async function readSampleWeek(week: SampleWeek): Promise<SampleMealInput[]> {
  const meals = await prisma.meal.findMany({
    where: { name: { in: [...week.meals] }, householdId: null, deletedAt: null },
    // The oldest row wins if a name were ever in the library twice.
    orderBy: { createdAt: 'asc' },
    include: {
      components: { include: { ingredient: true } },
      preparationSteps: { where: { locale: LOCALE } },
    },
  })

  return week.meals.flatMap((name) => {
    const meal = meals.find((candidate) => candidate.name === name)
    if (!meal) return []
    const shown = translateMeal(meal, LOCALE)
    const row = freshStepsRow(meal, LOCALE)
    const steps = row ? (parsePreparationSteps(row.steps)?.steps ?? null) : null
    return [
      {
        id: meal.id,
        name: shown.name,
        description: shown.description ?? null,
        kidFriendly: meal.kidFriendly,
        timeMinutes: meal.timeMinutes,
        primaryProteinType: meal.primaryProteinType,
        ...presentMealImage(meal),
        steps,
        components: meal.components.map((comp) => ({
          ingredientId: comp.ingredientId,
          quantityPerServing: comp.quantityPerServing,
          isVague: comp.isVague,
          originalPhrase: comp.originalPhrase,
          ingredient: {
            id: comp.ingredient.id,
            name: translateIngredient(comp.ingredient, LOCALE).name,
            category: comp.ingredient.category,
            defaultUnit: comp.ingredient.defaultUnit,
            gramsPerPiece: comp.ingredient.gramsPerPiece,
            measuredByVolume: comp.ingredient.measuredByVolume,
          },
        })),
      },
    ]
  })
}

/**
 * `readSampleWeek`, cached for a day per slug. The library changes only on a
 * deploy's seed run or an image batch, so a page a day behind is fine, and a
 * crawler's visits do not each query the database. Nothing runs at build
 * time: the route renders per request (the root layout reads the CSP nonce
 * from the headers), so CI's database-less build never reaches this. The
 * week is part of the cache key, so a change to its meals misses the cache.
 */
export const loadSampleWeek = unstable_cache(readSampleWeek, ['sample-week'], {
  revalidate: 86400,
})
