import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { matchIngredients, type IngredientMatchResult } from './match-ingredients'
import type { ExtractedIngredient } from './recipe-schema'

// Runs against PGlite with pg_trgm through the `unit-db` project, with no mocks:
// the rows are written with Prisma and found by the real trigram search (HON-1267).

function extracted(name: string): ExtractedIngredient {
  return {
    name,
    quantity: 1,
    unit: 'piece',
    originalText: `1 ${name}`,
    isVague: false,
    vaguePhrase: null,
    isDried: null,
  }
}

function ingredient(id: string, name: string, householdId: string | null = null) {
  return prisma.ingredient.create({
    data: {
      id,
      name,
      householdId,
      category: 'vegetable',
      defaultUnit: 'piece',
      calories: 50,
      protein: 1,
      carbs: 10,
      fat: 0,
    },
  })
}

/** The match for one recipe name, as `matchIngredients` returns it. */
async function matchOne(name: string, householdId?: string): Promise<IngredientMatchResult> {
  const [result] = await matchIngredients([extracted(name)], 4, { householdId })
  return result!
}

describe('matchIngredients on a plural catalogue name', () => {
  it.each([
    ['bay leaf', 'ing-bay-leaves', 'bay leaves'],
    ['pea', 'ing-peas', 'peas'],
    ['anchovy', 'ing-anchovies', 'anchovies'],
    ['clam', 'ing-clams', 'clams'],
    ['date', 'ing-dates', 'dates'],
    ['vine leaf', 'ing-vine-leaves', 'vine leaves'],
    ['wonton wrapper', 'ing-wonton-wrappers', 'wonton wrappers'],
    ['pine nut', 'ing-pine-nuts', 'pine nuts'],
  ])('matches "%s" to the global row %s, not to verify', async (recipeName, id, rowName) => {
    await ingredient(id, rowName)

    const result = await matchOne(recipeName)

    expect(result).toMatchObject({
      type: 'matched',
      ingredient: { id, name: rowName },
      lowConfidence: false,
    })
  })

  it('matches "sloe" to the household\'s own "sloes" row', async () => {
    const household = await prisma.household.create({ data: { name: 'Alder' } })
    await ingredient('ing-sloes', 'sloes', household.id)

    const result = await matchOne('sloe', household.id)

    expect(result).toMatchObject({
      type: 'matched',
      ingredient: { id: 'ing-sloes', name: 'sloes' },
      lowConfidence: false,
    })
  })

  it('matches "berry" to the household\'s own "berries" row, which scores 0.40 against "berry"', async () => {
    const household = await prisma.household.create({ data: { name: 'Birch' } })
    await ingredient('ing-berries', 'berries', household.id)

    const result = await matchOne('berry', household.id)

    expect(result).toMatchObject({
      type: 'matched',
      ingredient: { id: 'ing-berries', name: 'berries' },
      lowConfidence: false,
    })
  })

  it('still matches a plural recipe word to a singular row: "carrots" → "carrot"', async () => {
    await ingredient('ing-carrot', 'carrot')

    const result = await matchOne('carrots')

    expect(result).toMatchObject({
      type: 'matched',
      ingredient: { id: 'ing-carrot', name: 'carrot' },
      lowConfidence: false,
    })
  })
})
