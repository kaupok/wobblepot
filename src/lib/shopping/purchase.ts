import 'server-only'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { compareIngredientIds } from '@/lib/meal-planning/pantry'
import { ingredientTranslationsInclude, translateIngredient } from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'

/**
 * Marking shopping list items purchased and unpurchased, shared by
 * `POST /api/shopping-list/purchase`, `POST /api/shopping-list/unpurchase` and
 * the `mark_purchased` MCP tool (HON-1154), so the two paths cannot drift.
 * Purchasing an ingredient puts it in the pantry; unpurchasing takes it out.
 */

export const ingredientIdSchema = z.string().min(1)

// `.min(1)` because an empty list would purchase nothing and still succeed
// (HON-659).
export const ingredientIdsSchema = z.array(ingredientIdSchema).min(1)

/** How long after a purchase it can be undone, so an older pantry item is never removed. */
export const UNPURCHASE_WINDOW_DAYS = 7

export type PurchaseResult = {
  ingredientId: string
  /**
   * The quantity above 0 the purchase replaced with `null`, or `null` if it
   * replaced none. An undo deletes the pantry item, so the `mark_purchased`
   * MCP tool returns it and the assistant can set it back (HON-1176).
   */
  replacedQuantity: number | null
  pantryItem: {
    id: string
    ingredient: {
      id: string
      name: string
      category: string
      defaultUnit: string
    }
    quantity: number | null
    isStaple: boolean
    updatedAt: string
  }
}

export type PurchaseOutcome =
  | { status: 'purchased'; results: PurchaseResult[] }
  | { status: 'invalid_ids'; invalidIds: string[] }

/**
 * Puts each ingredient in the household's pantry, or touches its row if it is
 * there already, in one transaction. Every id must be a global ingredient or
 * the household's own; otherwise nothing is written and the outcome names the
 * invalid ids. Another household's ingredient reads as invalid, so its id is
 * not revealed (HON-889).
 *
 * `results` follow the caller's order, a repeated id at each of its positions.
 */
export async function purchaseIngredients(
  household: { id: string; locale: string | null },
  ingredientIds: string[],
): Promise<PurchaseOutcome> {
  const ingredients = await prisma.ingredient.findMany({
    where: {
      id: { in: ingredientIds },
      OR: [{ householdId: null }, { householdId: household.id }],
    },
    select: { id: true },
  })

  const foundIds = new Set(ingredients.map((i) => i.id))
  const invalidIds = ingredientIds.filter((id) => !foundIds.has(id))
  if (invalidIds.length > 0) return { status: 'invalid_ids', invalidIds }

  // Take the pantry row locks in a deterministic order. Every transaction
  // that locks more than one pantry row has to lock them in the same order:
  // two that lock the same rows in opposite orders end up each holding the
  // row the other needs next and deadlock (Postgres 40P01), which rolls the
  // whole purchase back. The realistic pair is this function and the
  // meal-completion deduction in PATCH /api/meal-plans/[id]/entries/[entryId]
  // — one member at the shop marking items purchased while another marks a
  // meal cooked — so both sort with the same comparator (HON-625, HON-632).
  //
  // Deduped as well as sorted: upserting one row twice in a single
  // transaction is pure waste. The results are rebuilt below over the
  // caller's array, so a repeated id still appears at both of its positions.
  const lockOrderedIngredientIds = [...new Set(ingredientIds)].sort(compareIngredientIds)

  // The client inserts these rows straight into the pantry list, so they
  // carry the household's name for each ingredient, as `loadPantry` does
  // (HON-913).
  const locale = resolveHouseholdLocale(household)

  const select = {
    id: true,
    quantity: true,
    isStaple: true,
    updatedAt: true,
    ingredient: {
      select: {
        id: true,
        name: true,
        category: true,
        defaultUnit: true,
        ...ingredientTranslationsInclude(locale),
      },
    },
  } satisfies Prisma.PantryItemSelect

  const upsertedByIngredientId = await prisma.$transaction(async (tx) => {
    const upserted = new Map<string, PurchaseResult>()

    for (const ingredientId of lockOrderedIngredientIds) {
      let pantryItem = await tx.pantryItem.upsert({
        where: {
          householdId_ingredientId: {
            householdId: household.id,
            ingredientId,
          },
        },
        create: {
          householdId: household.id,
          ingredientId,
          quantity: null,
          isStaple: false,
        },
        update: {
          // Touch updatedAt to mark as recently acquired
        },
        select,
      })
      // A purchase means "have some, amount unknown", and `loadShoppingList`
      // reads only that state as purchased. So a 0 ("ran out") and a quantity
      // the household entered are both replaced: a quantity above 0 would
      // read the same as an edit on the pantry page (HON-1173, HON-1176). The
      // row is locked by the upsert already, so the lock order above still
      // holds.
      const quantityBefore = pantryItem.quantity
      if (quantityBefore !== null) {
        pantryItem = await tx.pantryItem.update({
          where: { id: pantryItem.id },
          data: { quantity: null },
          select,
        })
      }
      const ingredientShown = translateIngredient(pantryItem.ingredient, locale)

      upserted.set(ingredientId, {
        ingredientId,
        replacedQuantity: quantityBefore !== null && quantityBefore > 0 ? quantityBefore : null,
        pantryItem: {
          id: pantryItem.id,
          ingredient: {
            id: ingredientShown.id,
            name: ingredientShown.name,
            category: ingredientShown.category,
            defaultUnit: ingredientShown.defaultUnit,
          },
          quantity: pantryItem.quantity,
          isStaple: pantryItem.isStaple,
          updatedAt: pantryItem.updatedAt.toISOString(),
        },
      })
    }

    return upserted
  })

  // Caller's order, deliberately not the lock order above: `results` is
  // positional. The non-null assertion holds because the lock order is a
  // permutation of the distinct ids, so every id here was upserted.
  return {
    status: 'purchased',
    results: ingredientIds.map((ingredientId) => upsertedByIngredientId.get(ingredientId)!),
  }
}

/**
 * - `removed`: the pantry item is gone
 * - `not_in_pantry`: the household has no pantry item for it
 * - `staple`: a staple stays in the pantry
 * - `too_old`: the pantry item is older than {@link UNPURCHASE_WINDOW_DAYS}, so
 *   it was not this purchase
 * - `has_quantity`: the pantry item has a quantity above 0, so it was not
 *   a purchase; returned only with `keepWithQuantity`
 */
export type UnpurchaseOutcome = 'removed' | 'not_in_pantry' | 'staple' | 'too_old' | 'has_quantity'

/**
 * Takes a recently purchased ingredient back out of the household's pantry.
 * Only the household's own pantry row is read or deleted.
 *
 * A purchase always leaves the quantity `null`, replacing any quantity the
 * row held (HON-1176), so a row with a quantity above 0 is one the household
 * set after, or without, a purchase. `keepWithQuantity` leaves such a row in
 * place. A quantity of 0 means "ran out" and is still removed: without the
 * row the ingredient reads as needed just the same, so nothing is lost. The
 * `mark_purchased` MCP tool sets it, so an assistant cannot delete a quantity
 * the household entered and the tool stays non-destructive (HON-1154). The
 * app's own undo does not, unchanged.
 */
export async function unpurchaseIngredient(
  householdId: string,
  ingredientId: string,
  options: { keepWithQuantity?: boolean } = {},
): Promise<UnpurchaseOutcome> {
  const pantryItem = await prisma.pantryItem.findUnique({
    where: {
      householdId_ingredientId: {
        householdId,
        ingredientId,
      },
    },
    select: {
      id: true,
      isStaple: true,
      quantity: true,
      updatedAt: true,
    },
  })

  if (!pantryItem) return 'not_in_pantry'
  if (pantryItem.isStaple) return 'staple'
  if (options.keepWithQuantity && pantryItem.quantity !== null && pantryItem.quantity > 0) {
    return 'has_quantity'
  }

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - UNPURCHASE_WINDOW_DAYS)
  if (pantryItem.updatedAt < cutoffDate) return 'too_old'

  await prisma.pantryItem.delete({
    where: { id: pantryItem.id },
  })
  return 'removed'
}
