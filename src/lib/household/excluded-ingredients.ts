import 'server-only'
import { prisma } from '@/lib/prisma'
import { DEFAULT_LOCALE } from '@/lib/i18n/locales'
import { matchTags, type ExcludedMatch } from '@/lib/household/excluded-ingredient-match'

export type { ExcludedMatch } from '@/lib/household/excluded-ingredient-match'

/**
 * A household's "Ingredients to avoid", resolved to ingredient rows when they
 * are read (HON-1321). Every planning filter and the conflict badge call
 * `getExcludedIngredientIds`, so they agree, and a household that saved its
 * tags before a rule change, or before a matching ingredient was added, gets
 * the current answer without saving again. The rule is in
 * `excluded-ingredient-match.ts`.
 *
 * Global and this household's own ingredients only: the matches are returned
 * to the household, so another household's would reveal them (HON-889).
 */
export async function matchExcludedIngredients(
  householdId: string,
  tags: readonly string[],
  locale: string = DEFAULT_LOCALE,
): Promise<ExcludedMatch[]> {
  if (tags.length === 0) return []
  // The whole pool, about a thousand rows: a `contains` prefilter in SQL
  // misses the plural row names ("mixed berries" for "berry").
  const pool = await prisma.ingredient.findMany({
    where: { OR: [{ householdId: null }, { householdId }] },
    select: { id: true, name: true, translations: { select: { locale: true, name: true } } },
  })
  return matchTags(tags, pool, locale)
}

/** The ids of every ingredient the household's tags exclude, for the planning filters. */
export async function getExcludedIngredientIds(
  householdId: string,
  tags: readonly string[],
): Promise<string[]> {
  const matches = await matchExcludedIngredients(householdId, tags)
  return [...new Set(matches.flatMap((match) => match.ingredients.map((i) => i.id)))]
}
