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
