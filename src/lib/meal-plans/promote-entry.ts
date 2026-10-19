import 'server-only'
import { prisma } from '@/lib/prisma'
import { MealPlanEntryStatus, type MealType } from '@/generated/prisma/enums'
import { mealTranslationsInclude, translateMeal } from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { discardMealImage } from '@/lib/meal-images/storage'
import {
  applyEntryChanges,
  changeSetKey,
  hasLiveChanges,
  type MergedComponent,
} from '@/lib/meal-planning/entry-components'
import { MAX_MEAL_COMPONENTS } from '@/lib/meal-planning/components-schema'
import { deriveProteinType } from '@/lib/meal-planning/protein'
import { clearChangesOnSwap } from '@/lib/meal-planning/swap-entry'
import { parsePreparationSteps } from '@/lib/preparation-steps'
import { HouseholdMealError, updateHouseholdMeal } from '@/lib/household-meals'
import { claimPlannedEntry, EntryChangeError, findOwnEntry } from './entry-changes'

/**
 * "Make it my recipe" (HON-1245), behind `POST
 * .../entries/[entryId]/components/promote`: keeps a planned entry's
 * ingredient changes for good. On a library meal it forks a household recipe
 * from the merged list and repoints the entry at it; on the household's own
 * recipe it writes the merged list into the recipe. Tested against a database
 * in `promote-entry.db.test.ts`.
 */

export type PromoteOutcome = 'forked' | 'updated'

const PROMOTE_ROUTE = '/api/meal-plans/[id]/entries/[entryId]/components/promote'

/** Mirrors the household meal create bounds (`/api/households/me/meals`). */
const MAX_PREPARATION_NOTES = 5000

const PROMOTE_INGREDIENT = {
  select: { proteinType: true, protein: true, defaultUnit: true, gramsPerPiece: true },
} as const

function readEntryForPromote(entryId: string, locale: string) {
  return prisma.mealPlanEntry.findUniqueOrThrow({
    where: { id: entryId },
    select: {
      status: true,
      preparationTips: true,
      meal: {
        select: {
          id: true,
          name: true,
          description: true,
          preparationNotes: true,
          timeMinutes: true,
          kidFriendly: true,
          suitableFor: true,
          servings: true,
          householdId: true,
          deletedAt: true,
          components: {
            select: {
              ingredientId: true,
              quantityPerServing: true,
              isVague: true,
              originalPhrase: true,
              ingredient: PROMOTE_INGREDIENT,
            },
          },
          ...mealTranslationsInclude(locale),
        },
      },
      changes: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          originalIngredientId: true,
          replacementIngredientId: true,
          quantityPerServing: true,
          replacementIngredient: PROMOTE_INGREDIENT,
        },
      },
    },
  })
}

type PromoteIngredient = Awaited<
  ReturnType<typeof readEntryForPromote>
>['changes'][number]['replacementIngredient'] & {}

/**
 * The new recipe's steps: the entry's cached steps, when it has them, one per
 * line. They were generated from the merged list (HON-1254), so they are the
 * recipe's own steps now. Equipment and tips are left out: the recipe form
 * has one free-text field. Otherwise the library meal's notes.
 */
function forkedNotes(preparationTips: string | null, mealNotes: string | null): string | null {
  const steps = preparationTips ? parsePreparationSteps(preparationTips)?.steps : undefined
  const notes = steps && steps.length > 0 ? steps.join('\n') : mealNotes
  return notes ? notes.slice(0, MAX_PREPARATION_NOTES) : null
}

/**
 * Keeps the entry's live changes as a recipe, and clears them from the entry.
 * Refuses `entryNotFound`, `notPlanned`, `mealNotFound` (deleted, or not the
 * household's to see), `noChanges` (no change applies), `invalidRecipe` (no
 * ingredient left, or too many), `ingredientNotFound` (an ingredient the
 * changes brought in is no longer visible, on an update), and `changesMoved`
 * (a change write landed between the read and the recipe write).
 */
export async function promoteEntry(
  householdId: string,
  planId: string,
  entryId: string,
  input: { name: string },
): Promise<{ outcome: PromoteOutcome; mealId: string }> {
  await findOwnEntry(householdId, planId, entryId)
  const household = await prisma.household.findUniqueOrThrow({
    where: { id: householdId },
    select: { locale: true },
  })
  const locale = resolveHouseholdLocale(household)
  const entry = await readEntryForPromote(entryId, locale)
  const { meal, changes } = entry

  if (entry.status !== MealPlanEntryStatus.planned || !meal) {
    throw new EntryChangeError('notPlanned')
  }
  if (meal.deletedAt || (meal.householdId !== null && meal.householdId !== householdId)) {
    throw new EntryChangeError('mealNotFound')
  }
  if (!hasLiveChanges(meal.components, changes)) throw new EntryChangeError('noChanges')

  const merged = applyEntryChanges(meal.components, changes)
  // The recipe form's bounds (`mealComponentsSchema`): every ingredient left
  // out is no recipe, and adds can push the list past the cap.
  if (merged.length === 0 || merged.length > MAX_MEAL_COMPONENTS) {
    throw new EntryChangeError('invalidRecipe')
  }

  if (meal.householdId === null) {
    const shown = translateMeal(meal, locale)
    const mealId = await forkMeal(householdId, entryId, changeSetKey(changes), merged, {
      name: input.name,
      description: shown.description,
      preparationNotes: forkedNotes(entry.preparationTips, shown.preparationNotes),
      timeMinutes: meal.timeMinutes,
      kidFriendly: meal.kidFriendly,
      suitableFor: meal.suitableFor,
      servings: meal.servings,
    })
    return { outcome: 'forked', mealId }
  }

  // The recipe write is shared by every planned entry of the recipe, so it must
  // not carry a change that was undone since the read. Not under the entry
  // lock (`updateHouseholdMeal` opens its own transaction), so a window of
  // milliseconds stays; the fork has none.
  const now = await prisma.mealPlanEntryComponent.findMany({
    where: { entryId },
    select: { id: true },
  })
  if (changeSetKey(now) !== changeSetKey(changes)) throw new EntryChangeError('changesMoved')

  await updateOwnRecipe(householdId, meal.id, meal.servings, merged)
  await clearPromotedChanges(
    entryId,
    changes.map((c) => c.id),
  )
  return { outcome: 'updated', mealId: meal.id }
}

/**
 * Creates the household recipe and repoints the entry at it, in one
 * transaction, so a refusal creates no meal. No `imageUrl`: a household meal
 * owns its image, and `clearMealImage` on a later edit would delete the
 * library meal's picture. No shared steps cache and no favourite either: the
 * recipe starts fresh.
 */
async function forkMeal(
  householdId: string,
  entryId: string,
  readKey: string,
  merged: MergedComponent<PromoteIngredient>[],
  data: {
    name: string
    description: string | null
    preparationNotes: string | null
    timeMinutes: number | null
    kidFriendly: boolean
    suitableFor: MealType[]
    servings: number
  },
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    // Locks the entry, re-tests that it is planned, and nulls its cached
    // steps, which were the entry's and now live on in `preparationNotes`.
    await claimPlannedEntry(tx, entryId)
    const now = await tx.mealPlanEntryComponent.findMany({
      where: { entryId },
      select: { id: true },
    })
    if (changeSetKey(now) !== readKey) throw new EntryChangeError('changesMoved')

    const meal = await tx.meal.create({
      data: {
        ...data,
        householdId,
        primaryProteinType: deriveProteinType(merged),
        components: {
          create: merged.map((c) => ({
            ingredientId: c.ingredientId,
            quantityPerServing: c.quantityPerServing,
            isVague: c.isVague,
            originalPhrase: c.originalPhrase,
          })),
        },
      },
      select: { id: true },
    })

    await clearChangesOnSwap(tx, entryId, meal.id)
    // Not `swapEntryData`'s reset: the serving override and the rating are
    // about this same dish, which only moved into the household's recipes.
    // The instruction went into the recipe with the changes it explained.
    const [repointed] = await tx.mealPlanEntry.updateManyAndReturn({
      where: { id: entryId, status: MealPlanEntryStatus.planned },
      data: { mealId: meal.id, preparationTips: null, adjustmentNote: null },
    })
    // Throwing rolls the new meal back with the refused repoint.
    if (!repointed) throw new EntryChangeError('notPlanned')
    return meal.id
  })
}

/**
 * Writes the merged list into the household's own recipe. `updateHouseholdMeal`
 * owns the lock, the protein type, the tips invalidation across every entry of
 * the recipe and the image rule; the cleared image goes once it committed.
 */
async function updateOwnRecipe(
  householdId: string,
  mealId: string,
  servings: number,
  merged: MergedComponent<unknown>[],
) {
  const { discardedImageUrl } = await updateHouseholdMeal(householdId, mealId, {
    components: merged.map((c) => ({
      ingredientId: c.ingredientId,
      totalQuantity: c.quantityPerServing * servings,
      isVague: c.isVague,
      originalPhrase: c.originalPhrase,
    })),
    // The divisor the totals were multiplied by. Without it the update divides
    // by the servings it reads under its lock, and a servings edit in between
    // would store every amount under the wrong divisor (HON-701).
    servings,
  }).catch((error: unknown) => {
    // The recipe was deleted since the read, or an ingredient the changes
    // brought in is no longer the household's to see.
    if (error instanceof HouseholdMealError) {
      throw new EntryChangeError(
        error.reason === 'mealNotFound' ? 'mealNotFound' : 'ingredientNotFound',
      )
    }
    throw error
  })
  await discardMealImage(discardedImageUrl, PROMOTE_ROUTE)
}

/**
 * Deletes the change rows the recipe now holds, and the instruction behind
 * them once none is left. Only the rows that were merged: a change made after
 * the read is not in the recipe, so it stays on the entry.
 *
 * Not one transaction with the recipe write. If this fails, the recipe has
 * the merged list and the rows are stale (`staleChangeIds`: the original is
 * gone from the recipe, or the recipe now has the replacement), so the merge
 * ignores them and the list offers their Undo.
 */
async function clearPromotedChanges(entryId: string, changeIds: string[]) {
  await prisma.$transaction(async (tx) => {
    await claimPlannedEntry(tx, entryId)
    await tx.mealPlanEntryComponent.deleteMany({ where: { entryId, id: { in: changeIds } } })
    const left = await tx.mealPlanEntryComponent.count({ where: { entryId } })
    if (left === 0) {
      await tx.mealPlanEntry.update({ where: { id: entryId }, data: { adjustmentNote: null } })
    }
  })
}
