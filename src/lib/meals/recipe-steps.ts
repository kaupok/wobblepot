import 'server-only'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'
import { stepsInputHash } from '@/lib/landing/steps-input-hash'
import { parsePreparationSteps } from '@/lib/preparation-steps'
import type { StepsRequestInput } from '@/lib/ai/preparation-steps'
import type { PreparationSteps } from '@/components/meal-plan/types'

/**
 * The reads and the write around `POST /api/meals/[id]/preparation-steps`: a
 * household recipe's steps in the My recipes cook view, cached in
 * `MealPreparationSteps` per meal and locale (HON-1338). Tested against a
 * database in `recipe-steps.db.test.ts`.
 */

export type RecipeStepsRefusal = 'not_found'

export class RecipeStepsError extends Error {
  constructor(readonly reason: RecipeStepsRefusal) {
    super(`Recipe steps refused: ${reason}`)
    this.name = 'RecipeStepsError'
  }
}

/**
 * One of the household's own recipes, not deleted, with its components, the
 * translation rows for `locale` (none for English), and its stored steps row
 * in `locale`, if any.
 *
 * Throws `not_found` for a library meal, another household's recipe, a
 * deleted one, or no meal at all.
 */
export async function loadRecipeForSteps(householdId: string, mealId: string, locale: string) {
  const meal = await prisma.meal.findFirst({
    where: { id: mealId, householdId, deletedAt: null },
    include: {
      ...mealTranslationsInclude(locale),
      components: {
        include: {
          ingredient: {
            select: {
              name: true,
              defaultUnit: true,
              measuredByVolume: true,
              ...ingredientTranslationsInclude(locale),
            },
          },
        },
      },
      preparationSteps: { where: { locale }, select: { inputHash: true, steps: true } },
    },
  })
  if (!meal) throw new RecipeStepsError('not_found')
  return meal
}

type LoadedRecipe = Awaited<ReturnType<typeof loadRecipeForSteps>>

/**
 * What the steps prompt reads for `meal` at `servings` in `locale`: the
 * household's names, the notes it would follow (null without any), and the
 * fingerprint of both. The route builds its request from `input` and `notes`,
 * so the hash covers exactly what the model was sent.
 */
export function recipeStepsRequest(meal: LoadedRecipe, locale: string, servings: number) {
  const shown = translateMeal(meal, locale)
  const input: StepsRequestInput = {
    mealName: shown.name,
    servings,
    timeMinutes: meal.timeMinutes,
    components: meal.components.map((comp) => ({
      name: translateIngredient(comp.ingredient, locale).name,
      quantityPerServing: comp.quantityPerServing,
      defaultUnit: comp.ingredient.defaultUnit,
      measuredByVolume: comp.ingredient.measuredByVolume,
    })),
    locale,
  }
  const notes = shown.preparationNotes?.trim() ? shown.preparationNotes : null
  return { input, notes, inputHash: recipeStepsInputHash(input, notes) }
}

/**
 * `stepsInputHash`, which the library rows use, plus the recipe's notes: the
 * notes prompt follows them, so a notes edit must make the row stale too.
 * Without notes it is the library hash itself.
 */
export function recipeStepsInputHash(input: StepsRequestInput, notes: string | null): string {
  const base = stepsInputHash(input)
  if (notes === null) return base
  return createHash('sha256').update(JSON.stringify({ base, notes })).digest('hex')
}

/**
 * The stored steps when they were written from `inputHash`, else null. The
 * hash covers the servings, so steps for another count are stale. A row with
 * no `steps` array is stale too, as `parseCachedPreparationSteps` treats one.
 */
export function freshRecipeSteps(meal: LoadedRecipe, inputHash: string): PreparationSteps | null {
  const row = meal.preparationSteps[0]
  if (!row || row.inputHash !== inputHash) return null
  const steps = parsePreparationSteps(row.steps)
  return steps && Array.isArray(steps.steps) ? steps : null
}

/** Stores the steps for the meal and locale, replacing the row there was. */
export async function saveRecipeSteps(
  row: { mealId: string; locale: string; servings: number; inputHash: string },
  steps: PreparationSteps,
): Promise<void> {
  const fields = {
    servings: row.servings,
    steps: JSON.stringify(steps),
    inputHash: row.inputHash,
  }
  await prisma.mealPreparationSteps.upsert({
    where: { mealId_locale: { mealId: row.mealId, locale: row.locale } },
    create: { mealId: row.mealId, locale: row.locale, ...fields },
    update: fields,
  })
}
