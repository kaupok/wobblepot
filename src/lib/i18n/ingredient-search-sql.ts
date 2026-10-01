import { Prisma } from '@/generated/prisma/client'
import { isDefaultLocale } from './locales'

interface IngredientNameMatchSql {
  /** LEFT JOIN onto the locale's translation row; empty for the default locale. */
  join: Prisma.Sql
  /** The name the household sees: the translation when one exists, else the English name. */
  displayName: Prisma.Sql
  /** Best pg_trgm similarity of the search against either name. */
  score: Prisma.Sql
}

/**
 * SQL fragments for a pg_trgm ingredient name search that also matches the
 * household's translated names (HON-911). The ingredient table must be
 * aliased `i`; the join adds `t`.
 *
 * For the default locale the join is empty and the score is the English name's
 * similarity alone, so English households run the same query as before.
 * Household-created ingredients have no translation row and match on their own
 * name either way.
 */
export function ingredientNameMatchSql(
  search: string,
  locale: string | null | undefined,
): IngredientNameMatchSql {
  if (isDefaultLocale(locale)) {
    return {
      join: Prisma.empty,
      displayName: Prisma.sql`i.name`,
      score: Prisma.sql`similarity(i.name, ${search})`,
    }
  }
  return {
    join: Prisma.sql`LEFT JOIN "ingredient_translation" t ON t."ingredientId" = i.id AND t.locale = ${locale}`,
    displayName: Prisma.sql`COALESCE(t.name, i.name)`,
    score: Prisma.sql`GREATEST(similarity(i.name, ${search}), COALESCE(similarity(t.name, ${search}), 0))`,
  }
}
