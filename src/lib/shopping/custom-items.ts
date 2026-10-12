import 'server-only'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { Prisma, type CustomShoppingItem } from '@/generated/prisma/client'
import { ingredientNameMatchSql } from '@/lib/i18n/ingredient-search-sql'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'

/**
 * Items a household adds to its shopping list by hand, shared by
 * `POST /api/shopping-list/custom`, `PATCH /api/shopping-list/custom/[id]` and
 * the `add_shopping_item` and `check_shopping_item` MCP tools (HON-1154), so
 * the two paths cannot drift.
 */

export const customItemNameSchema = z.string().trim().min(1).max(200)

export const customItemUpdateSchema = z.object({
  checked: z.boolean().optional(),
  ingredientId: z.string().nullable().optional(),
})

export type CustomItemUpdate = z.infer<typeof customItemUpdateSchema>

const AUTO_MATCH_THRESHOLD = 0.4

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
  | { status: 'exists'; existing: CustomShoppingItem | null }

/**
 * Adds an item to the household's shopping list. A name the household already
 * has is not added twice. The item is linked to the best-matching ingredient,
 * global or the household's own, so checking it off stocks the pantry.
 */
export async function addCustomShoppingItem(
  household: { id: string; locale: string | null },
  name: string,
): Promise<AddCustomItemOutcome> {
  const where = { householdId_name: { householdId: household.id, name } }
  const existing = await prisma.customShoppingItem.findUnique({ where })

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

  // Auto-match against ingredient database: global ingredients and this
  // household's own, never another household's (HON-889). The household types
  // names in its own language, so translated names match too (HON-911).
  let matchedIngredientId: string | null = null
  const match = ingredientNameMatchSql(name, resolveHouseholdLocale(household))

  try {
    const matches = await prisma.$queryRaw<{ id: string; similarity: number }[]>`
      SELECT
        i.id,
        ${match.score} as similarity
      FROM "ingredient" i
      ${match.join}
      WHERE ${match.score} >= ${AUTO_MATCH_THRESHOLD}
        AND (i."householdId" IS NULL OR i."householdId" = ${household.id})
      ORDER BY similarity DESC
      LIMIT 1
    `

    if (matches.length > 0 && matches[0]) {
      matchedIngredientId = matches[0].id
    }
  } catch {
    // If similarity search fails, create without match
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
      return { status: 'exists', existing: await prisma.customShoppingItem.findUnique({ where }) }
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
  | { status: 'updated'; item: CustomItemWithIngredient }
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

  const updated = await prisma.$transaction(async (tx) => {
    const updatedItem = await tx.customShoppingItem.update({
      where: { id },
      data: updateData,
      include: ITEM_INCLUDE,
    })

    // When checking a linked item, upsert pantry item (quantity = null = "have some")
    if (isChecking && effectiveIngredientId) {
      await tx.pantryItem.upsert({
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
        update: {
          // Touch updatedAt
        },
      })
    }

    return updatedItem
  })

  return { status: 'updated', item: updated }
}
