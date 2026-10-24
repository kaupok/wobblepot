import { prisma } from '@/lib/prisma'
import { isDefaultLocale } from '@/lib/i18n/content'
import type { IngredientMatchResult } from './match-ingredients'

/**
 * Overlay the locale's ingredient names onto matcher results, for the review
 * rows the parse and imagine routes return (HON-913).
 *
 * The matcher returns the canonical English `ingredient.name` and alternative
 * names, and the review UI renders them as-is, so an Estonian household
 * reviewing "must pipar" would see "black pepper". `matchedName` is not a
 * display name: a match made on the English name carries English there too.
 *
 * Only display names change; ids, `matchedName` and every other field pass
 * through. One query covers the matched ingredients and their alternatives.
 * An ingredient with no translation row (a household's own, or a gap in the
 * seed) keeps its English name, as in the list reads.
 */
export async function translateMatchResults<T extends IngredientMatchResult>(
  results: T[],
  locale: string | null | undefined,
): Promise<T[]> {
  if (isDefaultLocale(locale)) return results

  const ids = new Set<string>()
  for (const result of results) {
    if (result.type !== 'matched') continue
    ids.add(result.ingredient.id)
    for (const alt of result.alternatives ?? []) ids.add(alt.id)
  }
  if (ids.size === 0) return results

  const names = await translatedNames([...ids], locale as string)
  if (names.size === 0) return results
  const nameFor = (id: string, fallback: string) => names.get(id) ?? fallback

  return results.map((result) => {
    if (result.type !== 'matched') return result
    return {
      ...result,
      ingredient: {
        ...result.ingredient,
        name: nameFor(result.ingredient.id, result.ingredient.name),
      },
      alternatives: result.alternatives?.map((alt) => ({
        ...alt,
        name: nameFor(alt.id, alt.name),
      })),
    }
  })
}

/**
 * The locale's names for these ingredients, for a row the matcher did not
 * return: `create_meal` offers fuzzy candidates for a name it could not
 * match (HON-1305). An ingredient with no translation keeps its own name.
 */
export async function translateIngredientNames<T extends { id: string; name: string }>(
  ingredients: T[],
  locale: string | null | undefined,
): Promise<T[]> {
  if (isDefaultLocale(locale) || ingredients.length === 0) return ingredients
  const names = await translatedNames(
    ingredients.map((i) => i.id),
    locale as string,
  )
  return ingredients.map((i) => ({ ...i, name: names.get(i.id) ?? i.name }))
}

async function translatedNames(ids: string[], locale: string): Promise<Map<string, string>> {
  const translations = await prisma.ingredientTranslation.findMany({
    where: { locale, ingredientId: { in: ids } },
    select: { ingredientId: true, name: true },
  })
  return new Map(translations.map((t) => [t.ingredientId, t.name]))
}
