import { prisma } from '@/lib/prisma'
import type { IngredientCategory, Unit } from '@/generated/prisma/enums'
import { DEFAULT_LOCALE } from '@/lib/i18n/locales'

/**
 * Minimum similarity score for fuzzy ingredient matching.
 * Raised from 0.3 to 0.45 to prevent false positives like "baking powder" → "curry powder".
 */
export const SIMILARITY_THRESHOLD = 0.45

export type IngredientMatchSource = 'global' | 'household' | 'translation'

export type FuzzyIngredientMatch = {
  id: string
  name: string
  category: IngredientCategory
  subcategory: string | null
  defaultUnit: Unit
  gramsPerPiece: number | null
  calories: number
  protein: number
  carbs: number
  fat: number
  similarity: number
  source: IngredientMatchSource
}

/**
 * Perform fuzzy search for an ingredient name using pg_trgm across:
 *   1. Global pool (`householdId IS NULL`) — priority 1
 *   2. Household-scoped pool (`householdId = ?`) — priority 2 (only if `householdId` provided)
 *   3. Translation table for the requested locale — priority 3 (only if `locale` non-default)
 *
 * Results are ordered by source priority then similarity, so a global canonical
 * match always wins over a household-scoped or translation-only match. The
 * returned `name` is always the canonical English `ingredient.name` even when
 * matched via a translation row — callers translate for display via
 * `@/lib/i18n/content`.
 *
 * WHY: Translation-based matching reliability depends on Estonian translation
 * data being seeded (HON-506). Until then, the translation branch returns no
 * rows in practice and behaviour matches pre-i18n state.
 */
export async function fuzzySearchIngredient(
  searchName: string,
  options: { householdId?: string | null; locale?: string } = {},
): Promise<FuzzyIngredientMatch[]> {
  const householdIdParam = options.householdId ?? null
  const locale = options.locale ?? DEFAULT_LOCALE
  const localeParam = locale === DEFAULT_LOCALE ? null : locale

  return prisma.$queryRaw<FuzzyIngredientMatch[]>`
    SELECT * FROM (
      SELECT
        id,
        name,
        category,
        subcategory,
        "defaultUnit",
        "gramsPerPiece",
        calories,
        protein,
        carbs,
        fat,
        similarity(name, ${searchName}) AS similarity,
        'global'::text AS source,
        1 AS source_priority
      FROM "ingredient"
      WHERE "householdId" IS NULL
        AND similarity(name, ${searchName}) >= ${SIMILARITY_THRESHOLD}

      UNION ALL

      SELECT
        id,
        name,
        category,
        subcategory,
        "defaultUnit",
        "gramsPerPiece",
        calories,
        protein,
        carbs,
        fat,
        similarity(name, ${searchName}) AS similarity,
        'household'::text AS source,
        2 AS source_priority
      FROM "ingredient"
      WHERE "householdId" = ${householdIdParam}::text
        AND similarity(name, ${searchName}) >= ${SIMILARITY_THRESHOLD}

      UNION ALL

      SELECT
        i.id,
        i.name,
        i.category,
        i.subcategory,
        i."defaultUnit",
        i."gramsPerPiece",
        i.calories,
        i.protein,
        i.carbs,
        i.fat,
        similarity(t.name, ${searchName}) AS similarity,
        'translation'::text AS source,
        3 AS source_priority
      FROM "ingredient_translation" t
      INNER JOIN "ingredient" i ON i.id = t."ingredientId"
      WHERE t.locale = ${localeParam}::text
        AND similarity(t.name, ${searchName}) >= ${SIMILARITY_THRESHOLD}
        AND (i."householdId" IS NULL OR i."householdId" = ${householdIdParam}::text)
    ) AS results
    ORDER BY source_priority ASC, similarity DESC
    LIMIT 4
  `
}
