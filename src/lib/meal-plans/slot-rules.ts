import 'server-only'

import type { Prisma } from '@/generated/prisma/client'
import { MealPlanEntryStatus } from '@/generated/prisma/enums'
import {
  applyEntryChanges,
  changeSetKey,
  ENTRY_CHANGES_FOR_DEDUCTION,
} from '@/lib/meal-planning/entry-components'
import { compareIngredientIds } from '@/lib/meal-planning/pantry'
import {
  cookServingsSelect,
  getCookServings,
  getEffectiveServings,
  sumPortions,
} from '@/lib/meal-planning/servings'
import { COOK_OUTCOME_INGREDIENT_SELECT } from '@/lib/pantry/cook-outcome'
import { prisma } from '@/lib/prisma'

import { chargePantry, type Deduction, ranOutIngredientIds } from './cook-deduction'
import { type EntryPatch, EntryUpdateError, type UpdatedEntry, updateEntry } from './entries'
import { chargeFridgeEntry } from './fridge-meal'

/**
 * The rules of a slot with sides (HON-1610): the slot is one unit, so a main
 * and its sides move together. `updateEntry` asks `updateSlotStatus` first;
 * null means the entry's own rules apply. Tested in
 * `side-dishes.writes.db.test.ts`.
 *
 * - Cooked on the main completes every side in one transaction, and charges
 *   the pantry once per ingredient, summed across the dishes.
 * - Skip or revert on the main does the same to every side.
 * - A side completes only while its main is completed. Alone, it may be
 *   reverted or skipped.
 */

/** The patch keys a status change carries. */
const STATUS_KEYS = new Set<keyof EntryPatch>([
  'status',
  'deductPantry',
  'usedUpIngredientIds',
  'someLeftIngredientIds',
  'lowIngredientIds',
])

export async function updateSlotStatus(
  householdId: string,
  planId: string,
  entryId: string,
  patch: EntryPatch,
): Promise<UpdatedEntry | null> {
  const status = patch.status
  if (!status) return null

  const entry = await prisma.mealPlanEntry.findFirst({
    where: { id: entryId, planId, plan: { householdId } },
    select: {
      status: true,
      mainEntry: { select: { status: true } },
      _count: { select: { sides: true } },
    },
  })
  if (!entry) return null

  if (entry.mainEntry) {
    if (
      status === 'completed' &&
      entry.status !== MealPlanEntryStatus.completed &&
      entry.mainEntry.status !== MealPlanEntryStatus.completed
    ) {
      throw new EntryUpdateError('mainNotCompleted')
    }
    return null
  }
  if (entry._count.sides === 0) return null

  const rest = Object.fromEntries(
    Object.entries(patch).filter(([key]) => !STATUS_KEYS.has(key as keyof EntryPatch)),
  )
  // "Complete for N servings", or with a rating: written in the completion's
  // own transaction, so a refusal writes nothing, as `updateEntry` does.
  if (
    status === 'completed' &&
    entry.status !== MealPlanEntryStatus.completed &&
    Object.keys(rest).every((key) => key === 'servingOverride' || key === 'rating')
  ) {
    return completeSlot(householdId, planId, entryId, patch)
  }

  // Any other extra key (a swap, a note) goes first, on the entry's own path,
  // then the status moves the slot.
  if (Object.keys(rest).length > 0) {
    await updateEntry(householdId, planId, entryId, rest)
    const statusPatch = Object.fromEntries(
      Object.entries(patch).filter(([key]) => STATUS_KEYS.has(key as keyof EntryPatch)),
    )
    return updateSlotStatus(householdId, planId, entryId, statusPatch)
  }

  if (status !== 'completed') return setSlotStatus(entryId, status)
  return null
}

/**
 * Moves a main's sides after a swap changed the main's status (HON-1610). A
 * swap on a past day logs the main as eaten, so its planned sides are logged
 * too, at their servings and with the pantry marker, as `createSide` logs a
 * side of a cooked main (Q7). A swap out of skipped plans the main again, so
 * its skipped sides are planned again, as a revert does.
 */
export async function followMainStatus(
  mainEntryId: string,
  status: 'completed' | 'planned',
  householdServings: number,
): Promise<void> {
  if (status === 'planned') {
    await prisma.mealPlanEntry.updateMany({
      where: { mainEntryId, status: MealPlanEntryStatus.skipped },
      data: { status: MealPlanEntryStatus.planned },
    })
    return
  }
  const sides = await prisma.mealPlanEntry.findMany({
    where: { mainEntryId, status: MealPlanEntryStatus.planned },
    select: { id: true, servingOverride: true, mainEntry: { select: { servingOverride: true } } },
  })
  await prisma.$transaction(
    sides.map((side) =>
      prisma.mealPlanEntry.updateMany({
        where: { id: side.id, status: MealPlanEntryStatus.planned },
        data: {
          status: MealPlanEntryStatus.completed,
          cookedServings: getEffectiveServings(side, householdServings),
          pantryDeductedAt: new Date(),
        },
      }),
    ),
  )
}

/**
 * Throws `alreadyInSlot` when another dish of the entry's slot is `mealId`,
 * so a swap cannot put one recipe in a slot twice (Q8).
 */
export async function assertMealNotInSlot(entryId: string, mealId: string): Promise<void> {
  const entry = await prisma.mealPlanEntry.findUnique({
    where: { id: entryId },
    select: { mainEntryId: true },
  })
  const mainId = entry?.mainEntryId ?? entryId
  const taken = await prisma.mealPlanEntry.count({
    where: { id: { not: entryId }, mealId, OR: [{ id: mainId }, { mainEntryId: mainId }] },
  })
  if (taken > 0) throw new EntryUpdateError('alreadyInSlot')
}

/**
 * Writes `status` to the rows `where` matches. A row leaving `completed` drops
 * its cached tips and its cooked count, as `updateEntry` does (HON-684). The
 * pantry marker stays, so a revert does not restock (HON-651).
 */
async function writeStatus(
  tx: Prisma.TransactionClient,
  where: Prisma.MealPlanEntryWhereInput,
  status: 'planned' | 'skipped',
) {
  await tx.mealPlanEntry.updateMany({
    where: { ...where, status: MealPlanEntryStatus.completed },
    data: { status, preparationTips: null, cookedServings: null },
  })
  await tx.mealPlanEntry.updateMany({
    where: { ...where, status: { notIn: [MealPlanEntryStatus.completed, status] } },
    data: { status },
  })
}

async function setSlotStatus(
  entryId: string,
  status: 'planned' | 'skipped',
): Promise<UpdatedEntry> {
  return prisma.$transaction(async (tx) => {
    const { status: from } = await tx.mealPlanEntry.findUniqueOrThrow({
      where: { id: entryId },
      select: { status: true },
    })
    await writeStatus(tx, { id: entryId }, status)
    // A side skipped on its own while its main was cooked was not made, so a
    // revert of the main leaves it skipped, and the next Cooked does not
    // charge it.
    await writeStatus(
      tx,
      from === MealPlanEntryStatus.completed
        ? { mainEntryId: entryId, AND: [{ status: { not: MealPlanEntryStatus.skipped } }] }
        : { mainEntryId: entryId },
      status,
    )
    const main = await tx.mealPlanEntry.findUniqueOrThrow({
      where: { id: entryId },
      select: { id: true, status: true, mealId: true, rating: true },
    })
    return main
  })
}

const dishSelect = {
  id: true,
  mealId: true,
  kind: true,
  ...cookServingsSelect,
  pantryDeductedAt: true,
  meal: {
    select: {
      components: {
        select: {
          ingredientId: true,
          quantityPerServing: true,
          ingredient: { select: COOK_OUTCOME_INGREDIENT_SELECT },
        },
      },
    },
  },
  changes: {
    ...ENTRY_CHANGES_FOR_DEDUCTION,
    select: {
      ...ENTRY_CHANGES_FOR_DEDUCTION.select,
      replacementIngredient: { select: COOK_OUTCOME_INGREDIENT_SELECT },
    },
  },
} as const

/**
 * Completes a main and every side that is not completed yet, in one
 * transaction. Each dish gets its own `cookedServings` and `pantryDeductedAt`.
 * The charge is one deduction per ingredient, summed across the dishes, so an
 * ingredient two dishes use is charged once (Q6). A fridge main charges its
 * used-up items as `completeFridgeEntry` does, and its sides by their recipes
 * when the request asks to deduct. A `servingOverride` or `rating` in the
 * patch is written to the main in the same transaction, and the main and the
 * sides that follow it are priced at the new count.
 */
async function completeSlot(
  householdId: string,
  planId: string,
  entryId: string,
  patch: EntryPatch,
): Promise<UpdatedEntry> {
  const main = await prisma.mealPlanEntry.findFirst({
    where: { id: entryId, planId, plan: { householdId } },
    select: {
      ...dishSelect,
      rating: true,
      plan: {
        select: {
          household: {
            select: {
              members: { select: { preferences: { select: { portionMultiplier: true } } } },
            },
          },
        },
      },
      // A side the household skipped was not made, so it is neither
      // completed nor charged.
      sides: {
        where: { status: MealPlanEntryStatus.planned },
        orderBy: { id: 'asc' },
        select: dishSelect,
      },
    },
  })
  if (!main) throw new EntryUpdateError('entryNotFound')

  const householdServings = sumPortions(main.plan.household.members)
  const isFridge = main.kind === 'fridge'
  // What this request writes to the main besides its status.
  const servingOverride =
    'servingOverride' in patch ? (patch.servingOverride ?? null) : main.servingOverride
  const mainData = {
    ...('servingOverride' in patch && { servingOverride }),
    // The tips are priced at the old count (HON-681).
    ...(servingOverride !== main.servingOverride && { preparationTips: null }),
    ...('rating' in patch && { rating: patch.rating ?? null }),
  }
  const sides = main.sides.map((side) => ({ ...side, mainEntry: { servingOverride } }))
  // Only a completion that asks to deduct charges a recipe dish: a fridge
  // card with sides asks once its sides' dialog is confirmed (HON-1616).
  const charges = patch.deductPantry === true
  const recipeDishes = isFridge ? sides : [{ ...main, servingOverride }, ...sides]

  const priced = recipeDishes.map((dish) => {
    const cookServings = getCookServings(dish, householdServings)
    const components = applyEntryChanges(dish.meal?.components ?? [], dish.changes)
    const charged = charges && dish.pantryDeductedAt === null && components.length > 0
    return { dish, cookServings, components, charged }
  })

  // One deduction per ingredient, sorted for the lock order (HON-632).
  const sums = new Map<string, number>()
  for (const { components, cookServings, charged } of priced) {
    if (!charged) continue
    for (const { ingredientId, quantityPerServing } of components) {
      sums.set(ingredientId, (sums.get(ingredientId) ?? 0) + quantityPerServing * cookServings)
    }
  }
  const deductions: Deduction[] = [...sums]
    .map(([ingredientId, amount]) => ({ ingredientId, amount }))
    .sort((a, b) => compareIngredientIds(a.ingredientId, b.ingredientId))
  const outcomes = ranOutIngredientIds(
    priced.filter((p) => p.charged).flatMap((p) => p.components),
    deductions,
    patch.usedUpIngredientIds,
    patch.someLeftIngredientIds,
    patch.lowIngredientIds,
  )

  const pantryDeducted = await prisma.$transaction(async (tx) => {
    let fridgeCharged = false
    if (isFridge) {
      const data = { status: MealPlanEntryStatus.completed, ...mainData }
      fridgeCharged = await chargeFridgeEntry(
        tx,
        householdId,
        main.id,
        data,
        patch.usedUpIngredientIds ?? [],
      )
    }

    for (const { dish, cookServings, charged } of priced) {
      // The claim re-tests what the price was read with, as `updateEntry`'s
      // does (HON-633, HON-652); a dish that moved rolls the slot back.
      const [claimed] = await tx.mealPlanEntry.updateManyAndReturn({
        where: {
          id: dish.id,
          status: { not: MealPlanEntryStatus.completed },
          ...(charged && { pantryDeductedAt: null }),
        },
        data: {
          status: MealPlanEntryStatus.completed,
          ...(dish.kind === 'meal' && { cookedServings: cookServings }),
          ...(charged && { pantryDeductedAt: new Date() }),
          ...(dish.id === main.id && mainData),
        },
      })
      if (
        !claimed ||
        claimed.mealId !== dish.mealId ||
        claimed.servingOverride !== dish.servingOverride
      ) {
        throw new EntryUpdateError('staleMeal')
      }
      // And the ingredient changes, which a change write locks this row for
      // first (`claimPlannedEntry`, HON-1243): one committed since the read
      // is visible here.
      if (charged) {
        const changesNow = await tx.mealPlanEntryComponent.findMany({
          where: { entryId: dish.id },
          select: { id: true },
        })
        if (changeSetKey(changesNow) !== changeSetKey(dish.changes)) {
          throw new EntryUpdateError('staleMeal')
        }
      }
    }

    if (deductions.length > 0) await chargePantry(tx, householdId, deductions, outcomes)
    return fridgeCharged || deductions.length > 0
  })

  return {
    id: main.id,
    status: MealPlanEntryStatus.completed,
    mealId: main.mealId,
    rating: 'rating' in patch ? (patch.rating ?? null) : main.rating,
    pantryDeducted,
  }
}
