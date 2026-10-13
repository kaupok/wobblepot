import 'server-only'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { ingredientTranslationsInclude, translateIngredient } from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'

/**
 * Adding an ingredient to the pantry and changing a pantry item, shared by
 * `POST /api/pantry`, `PATCH /api/pantry/[id]` and the `set_pantry_quantity`
 * MCP tool (HON-1173), so the two paths cannot drift.
 */

// `quantity` floors at 0: `0` is a valid tracked state ("none left, still
// tracked"), `null` means "have some, amount unknown" (the deduction path
// treats it as fully consumed), and a negative would render on /shopping as a
// real on-hand amount and inflate the shopping quantity: `computeShoppingList`
// (src/lib/meal-planning/shopping-list.ts:279) and
// `computeRollingWindowShoppingList` (:475) both net via
// `Math.max(0, neededQty - pantry.quantity)`, which turns "500 needed, -500 on
// hand" into 1000 to buy. The needed-quantity aggregation in `loadPantry` is
// meal-plan-only and never reads `quantity`, so it is not the consumer at risk.
export const pantryQuantitySchema = z.number().min(0).nullable()

type Household = { id: string; locale: string | null }

function itemInclude(locale: string) {
  return {
    ingredient: {
      select: {
        id: true,
        name: true,
        category: true,
        defaultUnit: true,
        // `displayUnit` reads it, for the `unit` the MCP tool reports.
        measuredByVolume: true,
        ...ingredientTranslationsInclude(locale),
      },
    },
  } satisfies Prisma.PantryItemInclude
}

/** A pantry item with its ingredient, the name in the household's language. */
export interface PantryItemWithIngredient {
  id: string
  ingredientId: string
  quantity: number | null
  isStaple: boolean
  updatedAt: Date
  ingredient: {
    id: string
    name: string
    category: string
    defaultUnit: string
    measuredByVolume: boolean
  }
}

function withTranslatedIngredient<T extends { ingredient: { name: string } }>(
  item: T,
  locale: string,
): T {
  return { ...item, ingredient: translateIngredient(item.ingredient, locale) }
}

/**
 * - `created`: the new pantry item
 * - `ingredient_not_found`: the ingredient is neither global nor the
 *   household's own. Another household's reads the same, so its id is not
 *   revealed (HON-889).
 * - `exists`: the household's pantry has this ingredient already
 */
export type CreatePantryItemOutcome =
  | { status: 'created'; item: PantryItemWithIngredient }
  | { status: 'ingredient_not_found' }
  | { status: 'exists'; existingId: string }

/** Puts an ingredient in the household's pantry. */
export async function createPantryItem(
  household: Household,
  input: { ingredientId: string; quantity: number | null; isStaple: boolean },
): Promise<CreatePantryItemOutcome> {
  const ingredient = await prisma.ingredient.findFirst({
    where: {
      id: input.ingredientId,
      OR: [{ householdId: null }, { householdId: household.id }],
    },
    select: { id: true, name: true, category: true, defaultUnit: true },
  })

  if (!ingredient) return { status: 'ingredient_not_found' }

  // Unique constraint: householdId + ingredientId
  const where = {
    householdId_ingredientId: { householdId: household.id, ingredientId: input.ingredientId },
  }
  const existing = await prisma.pantryItem.findUnique({ where })

  if (existing) return { status: 'exists', existingId: existing.id }

  // `InlineAddItem` inserts the route's response straight into the pantry
  // list, so it carries the household's name for the ingredient, as
  // `loadPantry` does (HON-913).
  const locale = resolveHouseholdLocale(household)

  try {
    const item = await prisma.pantryItem.create({
      data: {
        householdId: household.id,
        ingredientId: input.ingredientId,
        quantity: input.quantity,
        isStaple: input.isStaple,
      },
      include: itemInclude(locale),
    })
    return { status: 'created', item: withTranslatedIngredient(item, locale) }
  } catch (error) {
    // A concurrent request added the same ingredient first.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await prisma.pantryItem.findUnique({ where })
      if (winner) return { status: 'exists', existingId: winner.id }
    }
    throw error
  }
}

/**
 * - `updated`: the item as saved
 * - `not_found`: no item with this id in this household's pantry. Another
 *   household's item reads the same.
 */
export type UpdatePantryItemOutcome =
  { status: 'updated'; item: PantryItemWithIngredient } | { status: 'not_found' }

/**
 * Changes a pantry item's quantity, staple flag or both. Only the fields
 * given are written. The caller makes sure at least one is given: an empty
 * update still bumps `@updatedAt`, which the shopping-list routes read as
 * "purchased" (HON-642).
 */
export async function updatePantryItem(
  household: Household,
  id: string,
  update: { quantity?: number | null; isStaple?: boolean },
): Promise<UpdatePantryItemOutcome> {
  const pantryItem = await prisma.pantryItem.findFirst({
    where: { id, householdId: household.id },
  })

  if (!pantryItem) return { status: 'not_found' }

  const data: { quantity?: number | null; isStaple?: boolean } = {}
  if (update.quantity !== undefined) data.quantity = update.quantity
  if (update.isStaple !== undefined) data.isStaple = update.isStaple

  // The app ignores the name today, but the item matches what `loadPantry`
  // returns for the same row (HON-913).
  const locale = resolveHouseholdLocale(household)

  try {
    const item = await prisma.pantryItem.update({
      where: { id },
      data,
      include: itemInclude(locale),
    })
    return { status: 'updated', item: withTranslatedIngredient(item, locale) }
  } catch (error) {
    // The household removed the item after the read above.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return { status: 'not_found' }
    }
    throw error
  }
}
