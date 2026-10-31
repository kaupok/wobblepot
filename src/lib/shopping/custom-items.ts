import 'server-only'

import { z } from 'zod'

import { Prisma } from '@/generated/prisma/client'
import { matchIngredients } from '@/lib/ai/match-ingredients'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { prisma } from '@/lib/prisma'

/**
 * Items a household adds to its shopping list by hand, shared by
 * `POST /api/shopping-list/custom`, `/api/shopping-list/custom/[id]`,
 * `DELETE /api/shopping-list/custom/checked` and
 * the `add_shopping_item` and `check_shopping_item` MCP tools (HON-1154), so
 * the two paths cannot drift.
 */

export const customItemNameSchema = z.string().trim().min(1).max(200)

export const customItemUpdateSchema = z.object({
  checked: z.boolean().optional(),
  ingredientId: z.string().nullable().optional(),
})

export type CustomItemUpdate = z.infer<typeof customItemUpdateSchema>

const ITEM_INCLUDE = {
  ingredient: {
    select: { id: true, name: true, category: true },
  },
} satisfies Prisma.CustomShoppingItemInclude

export type CustomItemWithIngredient = Prisma.CustomShoppingItemGetPayload<{
  include: typeof ITEM_INCLUDE
}>

/**
 * - `created`: a new item
 * - `reopened`: the item was on the list and checked, so it is unchecked again
 * - `exists`: the item is on the list and unchecked already. `existing` is null
 *   only when a concurrent request created it and it was gone again by the
 *   time it was read back.
 */
export type AddCustomItemOutcome =
  | { status: 'created'; item: CustomItemWithIngredient }
  | { status: 'reopened'; item: CustomItemWithIngredient }
  | { status: 'exists'; existing: CustomItemWithIngredient | null }

/**
 * Adds an item to the household's shopping list. A name the household already
 * has is not added twice. The item is linked to an ingredient, global or the
 * household's own, only when the matcher is sure, so checking it off stocks
 * the pantry. An unsure match leaves it unlinked, because a wrong link stocks
 * a wrong, possibly restricted, food (HON-1498).
 */
export async function addCustomShoppingItem(
  household: { id: string; locale: string | null },
  name: string,
): Promise<AddCustomItemOutcome> {
  const where = { householdId_name: { householdId: household.id, name } }
  const existing = await prisma.customShoppingItem.findUnique({ where, include: ITEM_INCLUDE })

  if (existing) {
    // Re-adding a checked item puts it back on the list.
    if (existing.checked) {
      const item = await prisma.customShoppingItem.update({
        where: { id: existing.id },
        data: { checked: false },
        include: ITEM_INCLUDE,
      })
      return { status: 'reopened', item }
    }
    return { status: 'exists', existing }
  }

  // Match as the recipe import does: global ingredients and this household's
  // own, never another household's (HON-889), with names in the household's
  // language (HON-911) and an exact translation ahead of an English name
  // (HON-912), so an Estonian "paprika" is bell pepper, not the spice.
  let matchedIngredientId: string | null = null
  try {
    const [result] = await matchIngredients(
      [
        {
          name,
          quantity: null,
          unit: null,
          originalText: name,
          isVague: false,
          vaguePhrase: null,
          isDried: null,
        },
      ],
      1,
      { householdId: household.id, locale: resolveHouseholdLocale(household) },
    )
    if (result?.type === 'matched' && !result.lowConfidence) {
      matchedIngredientId = result.ingredient.id
    }
  } catch {
    // If matching fails, create without a link
  }

  try {
    const item = await prisma.customShoppingItem.create({
      data: {
        householdId: household.id,
        name,
        ingredientId: matchedIngredientId,
      },
      include: ITEM_INCLUDE,
    })
    return { status: 'created', item }
  } catch (error) {
    // A concurrent request added the same name first.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return {
        status: 'exists',
        existing: await prisma.customShoppingItem.findUnique({ where, include: ITEM_INCLUDE }),
      }
    }
    throw error
  }
}

/**
 * - `updated`: the item as saved
 * - `not_found`: no item with this id on this household's list. Another
 *   household's item reads the same, so its id is not revealed.
 * - `ingredient_not_found`: the new ingredient link is neither global nor the
 *   household's own (HON-889)
 */
export type UpdateCustomItemOutcome =
  | {
      status: 'updated'
      item: CustomItemWithIngredient
      /**
       * The pantry quantity above 0 that checking the item replaced with
       * `null`, or `null` if it replaced none. Unchecking does not restore it,
       * so the `check_shopping_item` MCP tool returns it (HON-1176).
       */
      replacedQuantity: number | null
    }
  | { status: 'not_found' }
  | { status: 'ingredient_not_found' }

/**
 * Checks or unchecks a custom item, or changes its ingredient link. Checking a
 * linked item that was unchecked also puts its ingredient in the pantry
 * (quantity unknown, "have some"), in the same transaction.
 */
export async function updateCustomShoppingItem(
  householdId: string,
  id: string,
  update: CustomItemUpdate,
): Promise<UpdateCustomItemOutcome> {
  const current = await prisma.customShoppingItem.findUnique({ where: { id } })
  if (!current || current.householdId !== householdId) return { status: 'not_found' }

  const { checked, ingredientId } = update

  // A new link must point at a global ingredient or this household's own.
  // `null` unlinks; anything else, an empty string included, is looked up.
  if (ingredientId != null) {
    const ingredient = await prisma.ingredient.findFirst({
      where: {
        id: ingredientId,
        OR: [{ householdId: null }, { householdId }],
      },
      select: { id: true },
    })

    if (!ingredient) return { status: 'ingredient_not_found' }
  }

  const updateData: { checked?: boolean; ingredientId?: string | null } = {}
  if (checked !== undefined) updateData.checked = checked
  if (ingredientId !== undefined) updateData.ingredientId = ingredientId

  const effectiveIngredientId = ingredientId !== undefined ? ingredientId : current.ingredientId
  const isChecking = checked === true && !current.checked

  const { updatedItem, replacedQuantity } = await prisma.$transaction(async (tx) => {
    let replacedQuantity: number | null = null
    const updatedItem = await tx.customShoppingItem.update({
      where: { id },
      data: updateData,
      include: ITEM_INCLUDE,
    })

    // When checking a linked item, upsert pantry item (quantity = null = "have some")
    if (isChecking && effectiveIngredientId) {
      const pantryItem = await tx.pantryItem.upsert({
        where: {
          householdId_ingredientId: {
            householdId,
            ingredientId: effectiveIngredientId,
          },
        },
        create: {
          householdId,
          ingredientId: effectiveIngredientId,
          quantity: null,
          isStaple: false,
        },
        // Renews the unpurchase window, as in `purchaseIngredients`. Prisma
        // leaves `@updatedAt` alone on an empty update, so set it (HON-1233).
        update: { updatedAt: new Date() },
      })
      // Buying it means "have some", the only state the shopping list reads
      // as purchased, so a 0 or an entered quantity is replaced, as in
      // `purchaseIngredients` (HON-1173, HON-1176).
      if (pantryItem.quantity !== null) {
        if (pantryItem.quantity > 0) replacedQuantity = pantryItem.quantity
        await tx.pantryItem.update({ where: { id: pantryItem.id }, data: { quantity: null } })
      }
    }

    return { updatedItem, replacedQuantity }
  })

  return { status: 'updated', item: updatedItem, replacedQuantity }
}

/**
 * The name of one item on the household's list, or null when the household has
 * no item with this id. Lets a caller say what it removed, because
 * `deleteCustomShoppingItem` returns no row.
 */
export async function findCustomShoppingItemName(
  householdId: string,
  id: string,
): Promise<string | null> {
  const item = await prisma.customShoppingItem.findFirst({
    where: { id, householdId },
    select: { name: true },
  })
  return item?.name ?? null
}

/**
 * Removes one item from the household's list. Returns false when the household
 * has no item with this id; another household's item reads the same, so its id
 * is not revealed.
 */
export async function deleteCustomShoppingItem(householdId: string, id: string): Promise<boolean> {
  const { count } = await prisma.customShoppingItem.deleteMany({ where: { id, householdId } })
  return count > 0
}

/** Removes every checked item from the household's list and returns how many. */
export async function clearCheckedCustomShoppingItems(householdId: string): Promise<number> {
  const { count } = await prisma.customShoppingItem.deleteMany({
    where: { householdId, checked: true },
  })
  return count
}
