import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * The one query behind `POST /api/meals/imagine` (HON-1212). The route owns
 * the session, the household, the AI calls and the matching; this module owns
 * the read, and is tested against a database in `imagine-persist.db.test.ts`.
 *
 * Imagine saves nothing: the household's preferences arrive with its
 * membership, the ingredient pool is read inside `matchIngredients`, and a
 * suggestion becomes a meal only through `POST /api/meals`.
 */

/**
 * The per-100 g values and protein type `computeMealNutrition` and
 * `deriveProteinType` read, for the matched ingredients of one suggestion.
 * Ids come from the matcher, which already scopes them to the household. An
 * unknown id is absent from the result, and an empty list makes no query.
 */
export async function loadIngredientNutrition(ids: string[]) {
  if (ids.length === 0) return []
  return prisma.ingredient.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      calories: true,
      protein: true,
      carbs: true,
      fat: true,
      proteinType: true,
    },
  })
}
