import { ingredientTranslationsInclude, translateIngredient } from '@/lib/i18n/content'
import type { Locale } from '@/lib/i18n/locales'
import { loadCoverIds } from '@/lib/ingredient-form-cover-ids'
import { isCupboardIngredient } from '@/lib/pantry/cook-outcome'
import { prisma } from '@/lib/prisma'

import type {
  NeededIngredient,
  PantryCheckItem,
  PantryCoveredItem,
  ShoppingListItem,
} from './shopping-list'

/** An ingredient as the shopping list selects it, for a component and for a change's replacement. */
export function shoppingIngredientArgs(locale: Locale) {
  return {
    select: {
      id: true,
      name: true,
      category: true,
      subcategory: true,
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
 * to buy, and the needs the pantry covers (`atHome`, HON-1578). Both
 * shopping-list builders call it, so the pantry rules live once and the
 * two lists cannot disagree:
 *
 * - Not in the pantry, or quantity = 0 (ran out): the full amount
 * - quantity = null: nothing (have some, assume sufficient)
 * - quantity > 0: the difference
 * - Staple: never bought for a planned meal while the household has some.
 *   A staple at 0 (HON-1398) is a restock line. When a meal or extra needs
 *   it, the line has the planned amount and the need's first date (HON-1584),
 *   so the shopper can judge it against their next shop. When nothing does,
 *   it has no amount (`shoppingQuantity` 0) and is needed today.
 * - A bare herb (HON-1558): nothing, when a fresh or dried row of it
 *   (`INGREDIENT_FORM_COVERS`) is in the pantry and has not run out, whatever
 *   the bare row holds. The form row's amount is not deducted, because fresh
 *   and dried grams are not the same amount. A bare staple at 0 still restocks.
 * - A fresh herb (HON-1567): nothing, when its bare row holds the fresh plant
 *   (`FRESH_BARE_HERBS`), is in the pantry and has not run out. A dried herb
 *   has no such cover.
 * - Running low (HON-1586, `lowAt` set): at home as above, and also one line
 *   with `low`, staple or not. It has the shortfall when an amount falls
 *   short, else no amount (`shoppingQuantity` 0). Dated by the first planned
 *   need, or today when nothing planned needs it.
 *
 * A need is at home when its row is a staple not at 0, is covered by another
 * form of the herb, holds "have some" (null) or holds more than 0. A partial
 * amount is in both lists: the rest to buy, the pantry amount at home.
 *
 * A need is to check (`check`, HON-1584) when it is at home, every row that
 * keeps it there holds "have some" (null) and is not running low (a low row
 * is on the list already), two or more meals use it, it is not a cupboard item (`isCupboardIngredient`) and it is not vague. The list
 * assumes "have some" is enough, and the second meal is the one at risk.
 *
 * @param today - Start of today in the household's timezone
 */
export async function pantryShoppingLines(
  needed: ReadonlyMap<string, NeededIngredient>,
  householdId: string,
  locale: Locale,
  today: Date,
): Promise<{ lines: ShoppingListItem[]; atHome: PantryCoveredItem[]; check: PantryCheckItem[] }> {
  // The ingredient is for a ran-out or low row that no planned meal needs.
  const pantryItems = await prisma.pantryItem.findMany({
    where: { householdId },
    include: { ingredient: shoppingIngredientArgs(locale) },
  })
  const pantryMap = new Map(pantryItems.map((p) => [p.ingredientId, p]))

  // Herb id → in stock through another row of it: a bare herb through its
  // fresh or dried row, a fresh herb through its fresh bare row.
  const coverIds = await loadCoverIds()
  // Covered herb id → every row that covers it and has not run out. The At
  // home switch turns them all off, or another one keeps the need at home.
  const coveringRows = new Map<string, (typeof pantryItems)[number][]>()
  for (const p of pantryItems) {
    const coveredId = coverIds.get(p.ingredientId)
    if (p.quantity === 0 || !coveredId) continue
    coveringRows.set(coveredId, [...(coveringRows.get(coveredId) ?? []), p])
  }

  const shoppingList: ShoppingListItem[] = []
  const atHome: PantryCoveredItem[] = []
  const check: PantryCheckItem[] = []

  for (const [
    ingredientId,
    { ingredient, quantity: neededQty, mealCount, earliestNeededDate, isVague, originalPhrase },
  ] of needed) {
    const pantry = pantryMap.get(ingredientId)
    const restock = pantry?.isStaple === true && pantry.quantity === 0
    const low = pantry !== undefined && pantry.lowAt !== null

    const coveringRow = coveringRows.get(ingredientId)?.[0]
    // The rows that keep this need at home, its own row first. A staple at 0
    // restocks whatever covers it, so none does.
    const homeRows = restock
      ? []
      : [
          ...(pantry && pantry.quantity !== 0 ? [pantry] : []),
          ...(pantry?.isStaple ? [] : (coveringRows.get(ingredientId) ?? [])),
        ]
    const [first] = homeRows
    if (first) {
      const pantryRows = homeRows.map((row) => ({ id: row.id, quantity: row.quantity }))
      atHome.push({
        ingredientId,
        ingredient,
        // Only a counted own row, with no other form covering, caps the amount.
        coveredQuantity:
          homeRows.length === 1 && first === pantry && !pantry.isStaple && pantry.quantity !== null
            ? Math.min(neededQty, pantry.quantity)
            : neededQty,
        earliestNeededDate,
        isVague,
        originalPhrase,
        pantryRows,
        isStaple: first.isStaple,
      })
      if (
        mealCount >= 2 &&
        !isVague &&
        homeRows.every((row) => row.quantity === null && row.lowAt === null) &&
        !isCupboardIngredient(ingredient.category, ingredient.subcategory ?? null)
      ) {
        check.push({
          ingredientId,
          ingredient,
          totalQuantity: neededQty,
          mealCount,
          earliestNeededDate,
          pantryRows,
          isStaple: first.isStaple,
        })
      }
    }

    let shoppingQty: number

    if ((pantry?.isStaple && !restock) || (!restock && coveringRow)) {
      // A staple the household has, or another row of this herb that covers
      // it, is at home. Not on the list unless the row is running low.
      if (!low) continue
      shoppingQty = 0
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

    // Only include if need to buy something, or the row is running low
    if (shoppingQty > 0 || low) {
      shoppingList.push({
        ingredientId,
        ingredient,
        neededQuantity: neededQty,
        pantryQuantity: pantry?.quantity ?? null,
        shoppingQuantity: shoppingQty,
        mealCount,
        earliestNeededDate,
        isVague,
        originalPhrase,
        ...(restock && { restock: true }),
        // Any other row at 0 (HON-1578): the household marked it ran out.
        ...(!restock && pantry?.quantity === 0 && { ranOut: true }),
        ...(low && { low: true }),
      })
    }
  }

  // A ran-out staple or a low row that nothing planned needs: one line with
  // no amount.
  for (const pantry of pantryItems) {
    if (needed.has(pantry.ingredientId)) continue
    const restock = pantry.isStaple && pantry.quantity === 0
    const low = pantry.lowAt !== null
    if (!restock && !low) continue
    // A low herb row that covers another form's need is dated by that need.
    const coveredNeed = low ? needed.get(coverIds.get(pantry.ingredientId) ?? '') : undefined
    shoppingList.push({
      ingredientId: pantry.ingredientId,
      ingredient: translateIngredient(pantry.ingredient, locale),
      neededQuantity: 0,
      pantryQuantity: pantry.quantity,
      shoppingQuantity: 0,
      mealCount: 0,
      earliestNeededDate: coveredNeed?.earliestNeededDate ?? today,
      isVague: false,
      originalPhrase: null,
      ...(restock && { restock: true }),
      ...(low && { low: true }),
    })
  }

  return { lines: shoppingList, atHome, check }
}
