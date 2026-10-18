import 'server-only'
import { prisma } from '@/lib/prisma'
import { MealPlanEntryStatus } from '@/generated/prisma/enums'
import type { Prisma } from '@/generated/prisma/client'
import { applyEntryChanges } from '@/lib/meal-planning/entry-components'
import type { EntryChangeInput, EntryChangeSetInput } from '@/lib/meal-planning/components-schema'

/**
 * Persistence for a planned entry's own ingredient changes (HON-1243), behind
 * `POST` and `PUT .../entries/[entryId]/components` and
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

/** Every ingredient the changes name is global or the household's own, or `ingredientNotFound`. */
async function assertVisibleIngredients(householdId: string, changes: readonly EntryChangeInput[]) {
  const ids = [
    ...new Set(
      changes.flatMap((c) =>
        [c.originalIngredientId, c.replacementIngredientId].filter(
          (id): id is string => id !== null,
        ),
      ),
    ),
  ]
  if (ids.length === 0) return
  const visible = await prisma.ingredient.count({
    where: { id: { in: ids }, OR: [{ householdId: null }, { householdId }] },
  })
  if (visible !== ids.length) throw new EntryChangeError('ingredientNotFound')
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
  await assertVisibleIngredients(householdId, [input])

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
      // Against the recipe and every stored change: an ingredient already
      // cooked in the meal, added, or brought in by another replacement would
      // otherwise be listed twice. A left-out one counts too, because Undo is
      // how it comes back. Stale changes count as well: a recipe edit can make
      // one live again, and its ingredient would then be listed twice.
      if (
        inMeal.has(replacement) ||
        changes.some((c) => c.replacementIngredientId === replacement)
      ) {
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
    // The instruction explained the changes; with none left it explains
    // nothing, and the steps must not follow it (HON-1244).
    const left = await tx.mealPlanEntryComponent.count({ where: { entryId } })
    if (left === 0) {
      await tx.mealPlanEntry.update({ where: { id: entryId }, data: { adjustmentNote: null } })
    }
    return { components: await mergedComponents(tx, entryId) }
  })
}

/**
 * Replaces a planned entry's whole change set with `input.changes`, and stores
 * the instruction they came from (HON-1244, "Adjust recipe"), in one
 * transaction: the old rows go, stale ones included, and the new ones are
 * written in order. An empty set clears the note too. Nulls the cached tips
 * as `addEntryChange` does, and returns the merged components.
 *
 * Each change has passed `entryChangeSchema`. The rules across the set are the
 * ones `addEntryChange` holds one row at a time: every original is in the
 * recipe, no original has two changes, and no ingredient is brought in twice
 * or brought in while the recipe already has it.
 */
export async function replaceEntryChanges(
  householdId: string,
  planId: string,
  entryId: string,
  input: EntryChangeSetInput,
) {
  await findOwnEntry(householdId, planId, entryId)
  await assertVisibleIngredients(householdId, input.changes)

  return prisma.$transaction(async (tx) => {
    await claimPlannedEntry(tx, entryId)
    const { meal } = await readEntryIngredients(tx, entryId)
    const inMeal = new Set((meal?.components ?? []).map((c) => c.ingredientId))

    const originals = new Set<string>()
    const brought = new Set<string>()
    for (const change of input.changes) {
      const original = change.originalIngredientId
      if (original !== null) {
        if (!inMeal.has(original)) throw new EntryChangeError('originalNotInMeal')
        if (originals.has(original)) throw new EntryChangeError('alreadyChanged')
        originals.add(original)
      }
      const replacement = change.replacementIngredientId
      if (replacement !== null) {
        if (inMeal.has(replacement) || brought.has(replacement)) {
          throw new EntryChangeError('alreadyInMeal')
        }
        brought.add(replacement)
      }
    }

    await tx.mealPlanEntryComponent.deleteMany({ where: { entryId } })
    // `now()` is the transaction's start, so every row would carry the same
    // `createdAt`, and the merge appends added rows in `createdAt` order.
    const base = Date.now()
    await tx.mealPlanEntryComponent.createMany({
      data: input.changes.map((change, i) => ({
        entryId,
        originalIngredientId: change.originalIngredientId,
        replacementIngredientId: change.replacementIngredientId,
        quantityPerServing: change.quantityPerServing,
        createdAt: new Date(base + i),
      })),
    })
    await tx.mealPlanEntry.update({
      where: { id: entryId },
      data: { adjustmentNote: input.changes.length > 0 ? input.adjustmentNote : null },
    })
    return { components: await mergedComponents(tx, entryId) }
  })
}
