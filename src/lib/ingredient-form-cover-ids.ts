import { INGREDIENT_COVER_PAIRS } from '@/lib/ingredient-form-covers'
import { prisma } from '@/lib/prisma'

/**
 * The herb cover pairs as ids of the global catalogue: pantry row id → id of
 * the recipe row it covers (HON-1558, HON-1567). A household row of the same
 * name is not a cover.
 */
export async function loadCoverIds(): Promise<Map<string, string>> {
  const names = [...new Set(INGREDIENT_COVER_PAIRS.flat())]
  const rows = await prisma.ingredient.findMany({
    where: { householdId: null, name: { in: names } },
    select: { id: true, name: true },
  })
  const idByName = new Map(rows.map((r) => [r.name, r.id]))

  const covers = new Map<string, string>()
  for (const [pantryName, coveredName] of INGREDIENT_COVER_PAIRS) {
    const pantryId = idByName.get(pantryName)
    const coveredId = idByName.get(coveredName)
    if (pantryId && coveredId) covers.set(pantryId, coveredId)
  }
  return covers
}
