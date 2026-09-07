import { prisma } from '@/lib/prisma'

/**
 * Get the names of non-staple pantry ingredients the household currently has in stock.
 *
 * Excludes:
 * - Staple items (always assumed available, not a meaningful signal)
 * - Items with quantity=0 ("ran out")
 *
 * Includes:
 * - Items with quantity=null ("have some")
 * - Items with quantity > 0 (specific amount in stock)
 */
export async function getPantryIngredientNames(householdId: string): Promise<string[]> {
  const pantryItems = await prisma.pantryItem.findMany({
    where: {
      householdId,
      isStaple: false,
      OR: [{ quantity: null }, { quantity: { gt: 0 } }],
    },
    select: {
      ingredient: {
        select: { name: true },
      },
    },
    orderBy: {
      ingredient: { name: 'asc' },
    },
  })

  return pantryItems.map((item) => item.ingredient.name)
}

/**
 * Compare two `ingredientId`s for the purpose of ordering pantry row locks.
 *
 * Every transaction that takes more than one pantry row lock must take them in
 * this order. Two transactions locking the same rows in opposite orders
 * deadlock (Postgres `40P01`); Postgres aborts one of them, and the route's
 * `catch` turns that into a 500 that rolls the whole operation back. A meal
 * completion deducting its components and a bulk "mark purchased" upserting
 * the shopping list are exactly such a pair, and one member cooking while
 * another is at the shop is the normal usage pattern for this app.
 *
 * Compared by code unit rather than `localeCompare`: the order only has to be
 * *the same* in every process, and a locale-aware collation is not — it
 * resolves the runtime's default locale, Estonian sorts `z` before `t`, and
 * cuids are base36. The default-locale form would reintroduce the deadlock
 * across runtimes (HON-625, HON-632).
 */
export function compareIngredientIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
