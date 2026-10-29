import 'server-only'

import { ingredientTranslationsInclude, translateIngredient } from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { prisma } from '@/lib/prisma'

/**
 * The shopping list's "Add item" reaches the household's staples (HON-1400):
 * its dropdown lists them, and an exact name typed and sent marks the staple
 * ran out in place of a custom item, so the list shows the ran-out line
 * (HON-1398) and not a second line for the same thing.
 */

type Household = { id: string; locale: string | null }

/** A staple as "Add item" matches it: both names, so either language finds it. */
export interface PantryStaple {
  id: string
  /** The name in the household's language. */
  name: string
  englishName: string
  quantity: number | null
}

/**
 * The household's staples. A household has few, so the client filters them
 * as the household types.
 */
export async function listPantryStaples(household: Household): Promise<PantryStaple[]> {
  const locale = resolveHouseholdLocale(household)
  const rows = await prisma.pantryItem.findMany({
    where: { householdId: household.id, isStaple: true },
    select: {
      id: true,
      quantity: true,
      ingredient: { select: { name: true, ...ingredientTranslationsInclude(locale) } },
    },
  })
  return rows
    .map((row) => ({
      id: row.id,
      name: translateIngredient(row.ingredient, locale).name,
      englishName: row.ingredient.name,
      quantity: row.quantity,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale))
}

/**
 * - `staple_ran_out`: the name is a staple's, and the staple is now ran out
 *   (`quantity: 0`). A staple that was ran out already is not written again.
 * - `no_match`: no staple has this name; the caller makes a custom item.
 */
export type MarkStapleRanOutOutcome =
  | { status: 'staple_ran_out'; pantryItemId: string; ingredientName: string }
  | { status: 'no_match' }

/**
 * Marks a staple ran out when `name` is its name exactly, ignoring case and
 * the space around it, in the household's language or in English. Only an
 * exact name connects: the custom item's fuzzy match would read "milk
 * chocolate" as milk, and the dropdown covers near names.
 */
export async function markStapleRanOutByName(
  household: Household,
  name: string,
): Promise<MarkStapleRanOutOutcome> {
  const typed = name.trim().toLowerCase()
  const staples = await listPantryStaples(household)
  const staple = staples.find(
    (s) => s.name.toLowerCase() === typed || s.englishName.toLowerCase() === typed,
  )
  if (!staple) return { status: 'no_match' }

  // A write bumps `@updatedAt`, so a staple at 0 already is left alone.
  if (staple.quantity !== 0) {
    await prisma.pantryItem.update({ where: { id: staple.id }, data: { quantity: 0 } })
  }
  return { status: 'staple_ran_out', pantryItemId: staple.id, ingredientName: staple.name }
}
