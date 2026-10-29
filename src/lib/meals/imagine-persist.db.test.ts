import { describe, expect, it } from 'vitest'

import { loadIngredientNutrition } from '@/lib/meals/imagine-persist'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.
// `POST /api/meals/imagine` mocks `loadIngredientNutrition` at the seam.

/** Alder's own eggs, and one ingredient from the shared pool the migrations seed. */
async function world() {
  const alder = await prisma.household.create({ data: { name: 'Alder' } })
  await prisma.ingredient.create({
    data: {
      id: 'ing-alder-eggs',
      name: 'Duck eggs',
      householdId: alder.id,
      category: 'protein',
      proteinType: 'eggs',
      defaultUnit: 'piece',
      gramsPerPiece: 70,
      calories: 185,
      protein: 12.8,
      carbs: 1.5,
      fat: 13.8,
    },
  })
  const shared = await prisma.ingredient.findFirstOrThrow({
    where: { householdId: null },
    orderBy: { id: 'asc' },
  })
  return { shared }
}

describe('loadIngredientNutrition', () => {
  it("returns the nutrition and protein type of the household's own and shared ingredients", async () => {
    const { shared } = await world()

    const rows = await loadIngredientNutrition(['ing-alder-eggs', shared.id])

    expect(rows.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [
        {
          id: 'ing-alder-eggs',
          calories: 185,
          protein: 12.8,
          carbs: 1.5,
          fat: 13.8,
          proteinType: 'eggs',
        },
        {
          id: shared.id,
          calories: shared.calories,
          protein: shared.protein,
          carbs: shared.carbs,
          fat: shared.fat,
          proteinType: shared.proteinType,
        },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    )
  })

  it('leaves out an id that matches no ingredient', async () => {
    await world()

    const rows = await loadIngredientNutrition(['ing-alder-eggs', 'ing-none'])

    expect(rows.map((row) => row.id)).toEqual(['ing-alder-eggs'])
  })

  it('returns an empty list for no ids', async () => {
    await world()

    expect(await loadIngredientNutrition([])).toEqual([])
  })
})
