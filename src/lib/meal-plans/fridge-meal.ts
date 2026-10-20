import 'server-only'
import { prisma } from '@/lib/prisma'
import { MealPlanEntryStatus } from '@/generated/prisma/enums'
import type { Prisma } from '@/generated/prisma/client'
import { compareIngredientIds } from '@/lib/meal-planning/pantry'
import type { FridgeItemInput } from './fridge-items'

/**
 * Persistence for fridge meals (HON-1277): an entry with no recipe, made of
 * items. `createEntry` creates one, `setFridgeItems` edits one or turns any
 * other entry into one, and `completeFridgeEntry` marks the pantry items the
 * household used up. Tested in `fridge-meal.db.test.ts`.
 */

/** An item names an ingredient or an entry this household may not see (404). */
export class FridgeItemNotFoundError extends Error {
  constructor() {
    super('Fridge meal item not found')
    this.name = 'FridgeItemNotFoundError'
  }
}

/** Why `setFridgeItems` refused: no such entry (404), or it is completed (409). */
export type SetFridgeItemsRefusal = 'entryNotFound' | 'completed'

export class SetFridgeItemsError extends Error {
  constructor(readonly reason: SetFridgeItemsRefusal) {
    super(`Fridge items refused: ${reason}`)
    this.name = 'SetFridgeItemsError'
  }
}

/**
 * The item rows for `items`, in order, after checking each source belongs to
 * the household. An ingredient is global or the household's own. A source
 * entry is a completed recipe meal in the household's plan: the picker offers
 * only those, and another household's entry would leak its meal name.
 */
export async function toItemRows(householdId: string, items: FridgeItemInput[]) {
  const ingredientIds = new Set(items.flatMap((i) => ('ingredientId' in i ? [i.ingredientId] : [])))
  const sourceEntryIds = new Set(
    items.flatMap((i) => ('sourceEntryId' in i ? [i.sourceEntryId] : [])),
  )

  const [ingredientCount, sourceCount] = await Promise.all([
    ingredientIds.size === 0
      ? 0
      : prisma.ingredient.count({
          where: {
            id: { in: [...ingredientIds] },
            OR: [{ householdId: null }, { householdId }],
          },
        }),
    sourceEntryIds.size === 0
      ? 0
      : prisma.mealPlanEntry.count({
          where: {
            id: { in: [...sourceEntryIds] },
            plan: { householdId },
            status: MealPlanEntryStatus.completed,
            mealId: { not: null },
          },
        }),
  ])
  if (ingredientCount !== ingredientIds.size || sourceCount !== sourceEntryIds.size) {
    throw new FridgeItemNotFoundError()
  }

  return items.map((item, position) => ({
    ingredientId: 'ingredientId' in item ? item.ingredientId : null,
    sourceEntryId: 'sourceEntryId' in item ? item.sourceEntryId : null,
    label: 'label' in item ? item.label : null,
    position,
  }))
}

/**
 * Makes the entry a fridge meal with these items, in place of what it held:
 * the household's way to edit the items, and to replace a planned recipe or
 * fill a note-only card. The note stays. Everything that described the recipe
 * goes: the tips, the serving override, the rating, the ingredient changes and
 * the "Adjust recipe" instruction.
 *
 * Refused on a completed entry, for the reason a swap is (HON-633): it records
 * what was eaten and what the pantry was charged for. The status is re-tested
 * in the write, so a completion that commits after the read still wins.
 */
export async function setFridgeItems(
  householdId: string,
  planId: string,
  entryId: string,
  items: FridgeItemInput[],
) {
  const entry = await prisma.mealPlanEntry.findFirst({
    where: { id: entryId, planId, plan: { householdId } },
    select: { id: true },
  })
  if (!entry) throw new SetFridgeItemsError('entryNotFound')

  const rows = await toItemRows(householdId, items)

  return prisma.$transaction(async (tx) => {
    const [updated] = await tx.mealPlanEntry.updateManyAndReturn({
      where: { id: entryId, status: { not: MealPlanEntryStatus.completed } },
      data: {
        kind: 'fridge',
        mealId: null,
        preparationTips: null,
        servingOverride: null,
        rating: null,
        adjustmentNote: null,
      },
    })
    if (!updated) throw new SetFridgeItemsError('completed')

    await tx.mealPlanEntryComponent.deleteMany({ where: { entryId } })
    await tx.mealPlanEntryItem.deleteMany({ where: { entryId } })
    await tx.mealPlanEntryItem.createMany({ data: rows.map((row) => ({ ...row, entryId })) })

    return { id: updated.id, status: updated.status, mealId: null, rating: null }
  })
}

/**
 * Completes a fridge meal and sets each used-up pantry item to quantity `0`,
 * "ran out", as the MCP `set_pantry_status` tool does. An ingredient the
 * pantry does not hold gets a row at `0`. Only the entry's own ingredient
 * items count, so a request cannot zero the rest of the pantry.
 *
 * At most once in the entry's life, by the recipe meal's rule (HON-651): the
 * claim sets `pantryDeductedAt` in the same transaction as the pantry writes,
 * and nothing clears it, so complete → revert → complete writes once. A
 * request that loses the claim completes the entry and writes no pantry row.
 * True when this request wrote the pantry.
 */
export async function completeFridgeEntry(
  householdId: string,
  entryId: string,
  data: Prisma.MealPlanEntryUncheckedUpdateManyInput,
  usedUpIngredientIds: string[],
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const items = await tx.mealPlanEntryItem.findMany({
      where: { entryId, ingredientId: { in: usedUpIngredientIds } },
      select: { ingredientId: true },
    })
    // The deduction's lock order, so a concurrent purchase cannot deadlock
    // this (HON-632).
    const ingredientIds = [...new Set(items.map((i) => i.ingredientId!))].sort(compareIngredientIds)
    // Nothing to write keeps the one charge for a later completion.
    const [claimed] =
      ingredientIds.length === 0
        ? []
        : await tx.mealPlanEntry.updateManyAndReturn({
            where: {
              id: entryId,
              kind: 'fridge',
              status: { not: MealPlanEntryStatus.completed },
              pantryDeductedAt: null,
            },
            data: { ...data, pantryDeductedAt: new Date() },
          })
    if (!claimed) {
      await tx.mealPlanEntry.updateMany({ where: { id: entryId }, data })
      return false
    }

    for (const ingredientId of ingredientIds) {
      await tx.pantryItem.upsert({
        where: { householdId_ingredientId: { householdId, ingredientId } },
        create: { householdId, ingredientId, quantity: 0, isStaple: false },
        update: { quantity: 0 },
      })
    }
    return true
  })
}
