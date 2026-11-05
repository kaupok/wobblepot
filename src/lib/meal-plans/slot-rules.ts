import 'server-only'

import type { Prisma } from '@/generated/prisma/client'
import { MealPlanEntryStatus } from '@/generated/prisma/enums'
import {
  applyEntryChanges,
  ENTRY_CHANGES_FOR_DEDUCTION,
} from '@/lib/meal-planning/entry-components'
import { compareIngredientIds } from '@/lib/meal-planning/pantry'
import { cookServingsSelect, getCookServings, sumPortions } from '@/lib/meal-planning/servings'
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

  // A main with sides and more than a status change, such as "complete for
  // N servings": the rest goes first, on the entry's own path, then the
  // status moves the slot.
  const rest = Object.fromEntries(
    Object.entries(patch).filter(([key]) => !STATUS_KEYS.has(key as keyof EntryPatch)),
  )
  if (Object.keys(rest).length > 0) {
    await updateEntry(householdId, planId, entryId, rest)
    const statusPatch = Object.fromEntries(
      Object.entries(patch).filter(([key]) => STATUS_KEYS.has(key as keyof EntryPatch)),
    )
    return updateSlotStatus(householdId, planId, entryId, statusPatch)
  }

  if (status !== 'completed') return setSlotStatus(entryId, status)
  if (entry.status === MealPlanEntryStatus.completed) return null
  return completeSlot(householdId, planId, entryId, patch)
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
    await writeStatus(tx, { id: entryId }, status)
    await writeStatus(tx, { mainEntryId: entryId }, status)
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
 * when the request asks to deduct.
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
  // Only a completion that asks to deduct charges a recipe dish: a fridge
  // card's completion names its items only, so its sides stay uncharged
  // until a dialog shows their rows.
  const charges = patch.deductPantry === true
  const recipeDishes = isFridge ? main.sides : [main, ...main.sides]

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
      const data = { status: MealPlanEntryStatus.completed }
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
        },
      })
      if (
        !claimed ||
        claimed.mealId !== dish.mealId ||
        claimed.servingOverride !== dish.servingOverride
      ) {
        throw new EntryUpdateError('staleMeal')
      }
    }

    if (deductions.length > 0) await chargePantry(tx, householdId, deductions, outcomes)
    return fridgeCharged || deductions.length > 0
  })

  return {
    id: main.id,
    status: MealPlanEntryStatus.completed,
    mealId: main.mealId,
    rating: main.rating,
    pantryDeducted,
  }
}
