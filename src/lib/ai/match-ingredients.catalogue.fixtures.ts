import { prisma } from '@/lib/prisma'

import { baseIngredients } from '../../../prisma/seed'
import { comprehensiveIngredients } from '../../../prisma/seed-comprehensive'
import { newIngredients } from '../../../prisma/seed-expansion'
import { importCoverageIngredients } from '../../../prisma/seed-import-coverage'
import { ingredientTranslationsEt } from '../../../prisma/seed-ingredient-translations-et'

// Shared by the matcher's PGlite word-list tests, which are split for the file-size cap

/** Every seeded row and Estonian name, so real neighbours compete for a recipe name */
export async function seedCatalogue() {
  const names = new Set<string>()
  const rows = [
    ...baseIngredients,
    ...newIngredients,
    ...comprehensiveIngredients,
    ...importCoverageIngredients,
  ].filter((row) => !names.has(row.name) && names.add(row.name))

  // A migration may have inserted a row already, so its id is read back by name
  await prisma.ingredient.createMany({
    data: rows.map((row) => ({
      name: row.name,
      category: row.category,
      defaultUnit: row.defaultUnit,
      calories: row.calories,
      protein: row.protein,
      carbs: row.carbs,
      fat: row.fat,
    })),
    skipDuplicates: true,
  })
  const saved = await prisma.ingredient.findMany({
    where: { householdId: null },
    select: { id: true, name: true },
  })
  const idOf = new Map(saved.map((row) => [row.name, row.id]))
  await prisma.ingredientTranslation.createMany({
    data: ingredientTranslationsEt
      .filter((row) => idOf.has(row.en))
      .map((row) => ({ ingredientId: idOf.get(row.en)!, locale: 'et', name: row.et })),
    skipDuplicates: true,
  })
}
