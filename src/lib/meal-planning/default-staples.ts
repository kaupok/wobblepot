import type { Prisma } from '@/generated/prisma/client'

/**
 * Global ingredients every household starts with as pantry staples (HON-769).
 * A staple is never put on the shopping list, so "salt to taste" stops showing
 * up as something to buy. The household can unmark any of them in the pantry.
 *
 * Deliberately just these three. Olive oil, sugar and flour are real purchases
 * for some households, so they stay opt-in.
 *
 * The backfill migration `20260924120000_add_default_staples` hardcodes the
 * same three names. It is frozen once merged, so changing this list later
 * needs a new migration of its own.
 */
export const DEFAULT_STAPLE_NAMES = ['salt', 'black pepper', 'water'] as const

type StapleClient = Pick<Prisma.TransactionClient, 'ingredient' | 'pantryItem'>

/**
 * Marks the default staples in a household's pantry. Returns how many rows it
 * created.
 *
 * Takes a transaction client so it runs inside the household-creation
 * transaction. It is also imported by `prisma/seed.ts`, which resolves `src/`
 * by relative path, so this module must have no runtime `@/` imports and no
 * `server-only` import (the import above is type-only).
 *
 * A global ingredient that is missing is skipped rather than thrown on, because
 * an incomplete seed must not break household creation. Existing pantry rows
 * are left alone, including one the household has already unmarked.
 */
export async function seedDefaultStaples(tx: StapleClient, householdId: string): Promise<number> {
  const ingredients = await tx.ingredient.findMany({
    where: { name: { in: [...DEFAULT_STAPLE_NAMES] }, householdId: null },
    select: { id: true },
  })
  if (ingredients.length === 0) return 0

  const existing = await tx.pantryItem.findMany({
    where: { householdId, ingredientId: { in: ingredients.map((i) => i.id) } },
    select: { ingredientId: true },
  })
  const present = new Set(existing.map((p) => p.ingredientId))
  const missing = ingredients.filter((i) => !present.has(i.id))
  if (missing.length === 0) return 0

  // `skipDuplicates` covers a concurrent insert between the read and the write.
  const { count } = await tx.pantryItem.createMany({
    data: missing.map((i) => ({
      householdId,
      ingredientId: i.id,
      isStaple: true,
      quantity: null,
    })),
    skipDuplicates: true,
  })
  return count
}
