import { describe, expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'

import { baseIngredients } from '../../../prisma/seed'
import { comprehensiveIngredients } from '../../../prisma/seed-comprehensive'
import { newIngredients } from '../../../prisma/seed-expansion'
import { importCoverageIngredients } from '../../../prisma/seed-import-coverage'
import { ingredientTranslationsEt } from '../../../prisma/seed-ingredient-translations-et'
import { matchIngredients } from './match-ingredients'
import { extracted } from './match-ingredients.fixtures'

// Runs against PGlite with pg_trgm through the `unit-db` project, with no mocks.

// HON-1603: a recipe's plain anchovies are the tinned fillets; the whole fish
// is `fresh anchovies`, and sardines stay fresh.
describe('matchIngredients on an anchovy or sardine name', () => {
  it.each([
    ['anchovies', 'en', 'tinned anchovies'],
    ['anchovy', 'en', 'tinned anchovies'],
    ['anchovy fillets', 'en', 'tinned anchovies'],
    ['anchovies in oil', 'en', 'tinned anchovies'],
    ['salted anchovies', 'en', 'tinned anchovies'],
    ['anšoovised', 'et', 'tinned anchovies'],
    ['anšoovisefileed', 'et', 'tinned anchovies'],
    ['fresh anchovies', 'en', 'fresh anchovies'],
    ['värsked anšoovised', 'et', 'fresh anchovies'],
    ['sardines', 'en', 'sardines'],
  ] as const)('matches "%s" (%s) to %s, sure', async (recipeName, locale, rowName) => {
    // Every seeded row with its seeded et name, so the fresh and tinned rows compete.
    const rows = [
      ...baseIngredients,
      ...comprehensiveIngredients,
      ...newIngredients,
      ...importCoverageIngredients,
    ]
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

    const [result] = await matchIngredients([extracted(recipeName)], 4, { locale })

    expect(result).toMatchObject({
      type: 'matched',
      ingredient: { name: rowName },
      lowConfidence: false,
    })
  })
})
