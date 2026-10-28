import { prisma } from '@/lib/prisma'
import { ingredientTranslationsInclude, translateIngredient } from '@/lib/i18n/content'
import type { Locale } from '@/lib/i18n/locales'
import type { NeededIngredient, ShoppingListItem } from './shopping-list'

/** An ingredient as the shopping list selects it, for a component and for a change's replacement. */
export function shoppingIngredientArgs(locale: Locale) {
  return {
    select: {
      id: true,
      name: true,
      category: true,
      defaultUnit: true,
      gramsPerPiece: true,
      measuredByVolume: true,
      pieceDisplay: true,
      ...ingredientTranslationsInclude(locale),
    },
  } as const
}

/**
 * Deduct the household's pantry from the planned need and return the lines
 * to buy. Both shopping-list builders call it, so the pantry rules live once:
 *
 * - Not in the pantry, or quantity = 0 (ran out): the full amount
 * - quantity = null: nothing (have some, assume sufficient)
 * - quantity > 0: the difference
 * - Staple: never bought for a planned meal while the household has some.
 *   A staple at 0 (HON-1398) is a restock line, needed today because none is
 *   at home now: with the planned amount when a meal or extra needs it, and
 *   with no amount (`shoppingQuantity` 0) when nothing does.
 *
 * @param today - Start of today in the household's timezone
 */
export async function pantryShoppingLines(
  needed: ReadonlyMap<string, NeededIngredient>,
  householdId: string,
  locale: Locale,
  today: Date,
): Promise<ShoppingListItem[]> {
  // The ingredient is for a ran-out staple that no planned meal needs.
  const pantryItems = await prisma.pantryItem.findMany({
    where: { householdId },
    include: { ingredient: shoppingIngredientArgs(locale) },
  })
  const pantryMap = new Map(pantryItems.map((p) => [p.ingredientId, p]))

  const shoppingList: ShoppingListItem[] = []

  for (const [
    ingredientId,
    { ingredient, quantity: neededQty, mealCount, earliestNeededDate, isVague, originalPhrase },
  ] of needed) {
    const pantry = pantryMap.get(ingredientId)
    const restock = pantry?.isStaple === true && pantry.quantity === 0

    let shoppingQty: number

    if (pantry?.isStaple && !restock) {
      // Staple the household has - always at home, not on the list
      continue
    } else if (!pantry) {
      // Not in pantry - need full amount
      shoppingQty = neededQty
    } else if (pantry.quantity === null) {
      // Have some, assume sufficient
      shoppingQty = 0
    } else if (pantry.quantity === 0) {
      // Ran out - need full amount
      shoppingQty = neededQty
    } else {
      // Have partial - calculate difference
      shoppingQty = Math.max(0, neededQty - pantry.quantity)
    }

    // Only include if need to buy something
    if (shoppingQty > 0) {
      shoppingList.push({
        ingredientId,
        ingredient,
        neededQuantity: neededQty,
        pantryQuantity: pantry?.quantity ?? null,
        shoppingQuantity: shoppingQty,
        mealCount,
        earliestNeededDate: restock ? today : earliestNeededDate,
        isVague,
        originalPhrase,
        ...(restock && { restock: true }),
      })
    }
  }

  // A ran-out staple that nothing planned needs: one line with no amount.
  for (const pantry of pantryItems) {
    if (!pantry.isStaple || pantry.quantity !== 0 || needed.has(pantry.ingredientId)) continue
    shoppingList.push({
      ingredientId: pantry.ingredientId,
      ingredient: translateIngredient(pantry.ingredient, locale),
      neededQuantity: 0,
      pantryQuantity: 0,
      shoppingQuantity: 0,
      mealCount: 0,
      earliestNeededDate: today,
      isVague: false,
      originalPhrase: null,
      restock: true,
    })
  }

  return shoppingList
}
