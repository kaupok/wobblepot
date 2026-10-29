import 'server-only'

import { type ExcludedMatch, matchTags } from '@/lib/household/excluded-ingredient-match'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { prisma } from '@/lib/prisma'

export type { ExcludedMatch } from '@/lib/household/excluded-ingredient-match'

/**
 * A household's "Ingredients to avoid", resolved to ingredient rows when they
 * are read (HON-1321). Every planning filter and the conflict badge call
 * `getExcludedIngredientIds`, so they agree, and a household that saved its
 * tags before a rule change, or before a matching ingredient was added, gets
 * the current answer without saving again. The rule is in
 * `excluded-ingredient-match.ts`, and the group words ("sausage") in
 * `ingredient-groups.ts`.
 *
 * Global and this household's own ingredients only: the matches are returned
 * to the household, so another household's would reveal them (HON-889).
 */
export async function matchExcludedIngredients(
  householdId: string,
  tags: readonly string[],
): Promise<ExcludedMatch[]> {
  if (tags.length === 0) return []
  // The whole pool, about a thousand rows: a `contains` prefilter in SQL
  // misses the plural row names ("mixed berries" for "berry"). The locale
  // decides how a tag reads (`matchTag`) and names the matches.
  const [household, pool] = await Promise.all([
    prisma.household.findUnique({ where: { id: householdId }, select: { locale: true } }),
    prisma.ingredient.findMany({
      where: { OR: [{ householdId: null }, { householdId }] },
      select: { id: true, name: true, translations: { select: { locale: true, name: true } } },
    }),
  ])
  return matchTags(tags, pool, resolveHouseholdLocale(household))
}

/** The ids of every ingredient the household's tags exclude, for the planning filters. */
export async function getExcludedIngredientIds(
  householdId: string,
  tags: readonly string[],
): Promise<string[]> {
  const matches = await matchExcludedIngredients(householdId, tags)
  return [...new Set(matches.flatMap((match) => match.ingredients.map((i) => i.id)))]
}
