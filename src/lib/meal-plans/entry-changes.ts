import 'server-only'
import { prisma } from '@/lib/prisma'
import { MealPlanEntryStatus } from '@/generated/prisma/enums'
import type { Prisma } from '@/generated/prisma/client'
import { applyEntryChanges } from '@/lib/meal-planning/entry-components'
import type { EntryChangeInput } from '@/lib/meal-planning/components-schema'

/**
 * Persistence for a planned entry's own ingredient changes (HON-1243), behind
 * `POST .../entries/[entryId]/components` and
 * `DELETE .../entries/[entryId]/components/[componentId]`. The routes own the
 * session and the body; these functions own every query and every invariant,
 * and are tested against a database in `entry-changes.db.test.ts`.
 */

/**
 * Why a change write refused. The routes map each one to its status:
 *
 * - `entryNotFound`: no such entry in this plan of this household (404).
 * - `changeNotFound`: no such change on this entry (404).
 * - `ingredientNotFound`: an ingredient the household cannot see — neither
 *   global nor its own (404). Same visibility rule `findSwapMeal` applies to
 *   meals.
 * - `notPlanned`: the entry is cooked or skipped, or has no meal (409). Its
 *   changes are history once the pantry was charged for them.
 * - `originalNotInMeal`: the original is not one of the meal's ingredients (400).
 * - `alreadyChanged`: the original already has a change; undo that first (409).
 * - `alreadyInMeal`: the replacement or added ingredient is in the meal
 *   already, so the list would name it twice (409).
 */
export type EntryChangeRefusal =
  | 'entryNotFound'
  | 'changeNotFound'
  | 'ingredientNotFound'
  | 'notPlanned'
  | 'originalNotInMeal'
  | 'alreadyChanged'
  | 'alreadyInMeal'

/** A refusal from a change write. Thrown so the transaction rolls back. */
export class EntryChangeError extends Error {
  constructor(readonly reason: EntryChangeRefusal) {
    super(`Entry change refused: ${reason}`)
    this.name = 'EntryChangeError'
  }
}

type Tx = Prisma.TransactionClient

/**
 * Takes the entry for a change write: re-tests that it is planned and nulls its
 * cached tips in one statement. The cached steps name the old ingredients, so
 * they must go with every change, in the change's own transaction.
 *
 * The statement also takes the entry's row lock. That serialises change writes
 * with each other — so the invariants below are checked against a change set
 * nobody else can move — and with the completion claim in `updateEntry`, which
 * re-reads the change set under the same lock.
 */
async function claimPlannedEntry(tx: Tx, entryId: string) {
  const { count } = await tx.mealPlanEntry.updateMany({
    where: { id: entryId, status: MealPlanEntryStatus.planned, mealId: { not: null } },
    data: { preparationTips: null },
  })
  if (count === 0) throw new EntryChangeError('notPlanned')
}

/** The entry's meal components and changes, read inside the write's lock. */
function readEntryIngredients(tx: Tx, entryId: string) {
  const ingredient = { select: { id: true, name: true, defaultUnit: true } } as const
  return tx.mealPlanEntry.findUniqueOrThrow({
    where: { id: entryId },
    select: {
      meal: {
        select: {
          components: { select: { ingredientId: true, quantityPerServing: true, ingredient } },
        },
      },
      changes: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          originalIngredientId: true,
          replacementIngredientId: true,
          quantityPerServing: true,
          replacementIngredient: ingredient,
        },
      },
    },
  })
}

async function mergedComponents(tx: Tx, entryId: string) {
  const { meal, changes } = await readEntryIngredients(tx, entryId)
  return applyEntryChanges(meal?.components ?? [], changes)
}

/** The entry of a plan the household owns, or `entryNotFound`. */
async function findOwnEntry(householdId: string, planId: string, entryId: string) {
  const entry = await prisma.mealPlanEntry.findFirst({
    where: { id: entryId, planId, plan: { householdId } },
    select: { id: true },
  })
  if (!entry) throw new EntryChangeError('entryNotFound')
}

/**
 * Records one change on a planned entry and returns the row with the entry's
 * merged components. The input has passed `entryChangeSchema`, so it names at
 * least one ingredient, carries a quantity exactly when it names a
 * replacement, and never replaces an ingredient with itself.
 */
export async function addEntryChange(
  householdId: string,
  planId: string,
  entryId: string,
  input: EntryChangeInput,
) {
  await findOwnEntry(householdId, planId, entryId)

  const ids = [input.originalIngredientId, input.replacementIngredientId].filter(
    (id): id is string => id !== null,
  )
  const visible = await prisma.ingredient.count({
    where: { id: { in: ids }, OR: [{ householdId: null }, { householdId }] },
  })
  if (visible !== ids.length) throw new EntryChangeError('ingredientNotFound')

  return prisma.$transaction(async (tx) => {
    await claimPlannedEntry(tx, entryId)
    const { meal, changes } = await readEntryIngredients(tx, entryId)
    const components = meal?.components ?? []
    const inMeal = new Set(components.map((c) => c.ingredientId))

    const original = input.originalIngredientId
    if (original !== null) {
      if (!inMeal.has(original)) throw new EntryChangeError('originalNotInMeal')
      // One row per original, stale ones included: Postgres cannot hold this,
      // because a unique index treats the "add" rows' nulls as distinct.
      if (changes.some((c) => c.originalIngredientId === original)) {
        throw new EntryChangeError('alreadyChanged')
      }
    }

    const replacement = input.replacementIngredientId
    if (replacement !== null) {
      // Against the recipe and the merged list both: an ingredient already
      // cooked in the meal, added, or brought in by another replacement would
      // otherwise be listed twice. A left-out one counts too, because Undo is
      // how it comes back.
      const merged = applyEntryChanges(components, changes)
      if (inMeal.has(replacement) || merged.some((c) => c.ingredientId === replacement)) {
        throw new EntryChangeError('alreadyInMeal')
      }
    }

    const change = await tx.mealPlanEntryComponent.create({
      data: {
        entryId,
        originalIngredientId: original,
        replacementIngredientId: replacement,
        quantityPerServing: input.quantityPerServing,
      },
    })
    return { change, components: await mergedComponents(tx, entryId) }
  })
}

/**
 * Reverts one change on a planned entry, and returns the entry's merged
 * components. Nulls the cached tips as `addEntryChange` does.
 */
export async function removeEntryChange(
  householdId: string,
  planId: string,
  entryId: string,
  changeId: string,
) {
  await findOwnEntry(householdId, planId, entryId)

  return prisma.$transaction(async (tx) => {
    await claimPlannedEntry(tx, entryId)
    const { count } = await tx.mealPlanEntryComponent.deleteMany({
      where: { id: changeId, entryId },
    })
    if (count === 0) throw new EntryChangeError('changeNotFound')
    return { components: await mergedComponents(tx, entryId) }
  })
}
