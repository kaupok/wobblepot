import { describe, expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'

import { baseIngredients } from '../../../prisma/seed'
import { comprehensiveIngredients } from '../../../prisma/seed-comprehensive'
import { newIngredients } from '../../../prisma/seed-expansion'
import { importCoverageIngredients } from '../../../prisma/seed-import-coverage'
import { ingredientTranslationsEt } from '../../../prisma/seed-ingredient-translations-et'
import { type IngredientMatchResult, matchIngredients } from './match-ingredients'
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

// HON-1313: normalization strips "canned", "frozen" and "dried", so the stripped
// name must not win a sure match on the fresh row when a form row exists.
describe('matchIngredients on a recipe name with a form word', () => {
  async function seedCatalogue() {
    await ingredient('ing-tomato', 'tomato')
    await ingredient('ing-tinned-chopped', 'tinned chopped tomatoes')
    await ingredient('ing-tinned-plum', 'tinned plum tomatoes')
    await ingredient('ing-peas', 'peas')
    await ingredient('ing-oregano', 'oregano')
    await ingredient('ing-cumin', 'cumin')
  }

  it('matches "canned chopped tomatoes" to "tinned chopped tomatoes", sure', async () => {
    await seedCatalogue()

    const result = await matchOne('canned chopped tomatoes')

    expect(result).toMatchObject({
      type: 'matched',
      ingredient: { id: 'ing-tinned-chopped', name: 'tinned chopped tomatoes' },
      lowConfidence: false,
    })
  })

  it('takes the tinned row the direct name finds over fresh "plum tomato": "canned plum tomatoes"', async () => {
    await seedCatalogue()

    const result = await matchOne('canned plum tomatoes')

    expect(result).toMatchObject({
      type: 'matched',
      ingredient: { id: 'ing-tinned-plum', name: 'tinned plum tomatoes' },
      lowConfidence: false,
    })
  })

  it('asks for review of "canned crushed tomatoes", with the tinned row first', async () => {
    await seedCatalogue()

    const result = await matchOne('canned crushed tomatoes')

    expect(result).toMatchObject({ type: 'matched', lowConfidence: true })
    if (result.type !== 'matched') throw new Error('expected a match')
    expect(result.alternatives?.[0]).toMatchObject({ id: 'ing-tinned-chopped' })
  })

  it.each([
    ['frozen peas', 'peas', false],
    ['dried oregano', 'dried oregano', false],
    ['dried cumin', 'cumin', false],
    ['canned tomatoes', 'tinned chopped tomatoes', true],
    ['canned diced tomatoes', 'tinned chopped tomatoes', false],
  ])('keeps the result for "%s": %s, low confidence %s', async (recipeName, rowName, low) => {
    await seedCatalogue()

    const result = await matchOne(recipeName)

    expect(result).toMatchObject({
      type: 'matched',
      ingredient: { name: rowName },
      lowConfidence: low,
    })
  })
})

// HON-1471: the catalogue has frozen form rows for the products a household keeps stocked.
describe('matchIngredients with the frozen form rows', () => {
  async function seedCatalogue() {
    await ingredient('ing-peas', 'peas')
    await ingredient('ing-frozen-peas', 'frozen peas')
    await ingredient('ing-broccoli', 'broccoli')
    await ingredient('ing-cauliflower', 'cauliflower')
    await ingredient('ing-frozen-mix', 'frozen broccoli and cauliflower mix')
  }

  it('matches "frozen peas" to the "frozen peas" row, sure', async () => {
    await seedCatalogue()

    expect(await matchOne('frozen peas')).toMatchObject({
      type: 'matched',
      ingredient: { id: 'ing-frozen-peas', name: 'frozen peas' },
      lowConfidence: false,
    })
  })

  it('still matches "peas" to the fresh "peas" row, sure', async () => {
    await seedCatalogue()

    expect(await matchOne('peas')).toMatchObject({
      type: 'matched',
      ingredient: { id: 'ing-peas', name: 'peas' },
      lowConfidence: false,
    })
  })

  it('saves "frozen broccoli" as fresh "broccoli", not as the broccoli and cauliflower mix', async () => {
    await seedCatalogue()

    expect(await matchOne('frozen broccoli')).toMatchObject({
      type: 'matched',
      ingredient: { id: 'ing-broccoli', name: 'broccoli' },
      lowConfidence: false,
    })
  })
})

// HON-1478: an Estonian household types the shop word, so each cut's Estonian
// name, singular or plural, must find that cut and not its neighbour.
describe('matchIngredients on an Estonian chicken cut', () => {
  async function seedCuts() {
    for (const [id, name] of [
      ['ing-drumstick', 'chicken drumstick'],
      ['ing-thigh', 'chicken thigh'],
      ['ing-leg', 'chicken leg'],
    ] as const) {
      // The seeded Estonian name, so a mixed-up seed turns this test red.
      const et = ingredientTranslationsEt.find((row) => row.en === name)!.et
      await ingredient(id, name)
      await prisma.ingredientTranslation.create({
        data: { ingredientId: id, locale: 'et', name: et },
      })
    }
  }

  it.each([
    ['kanakints', 'ing-thigh'],
    ['kanakintsud', 'ing-thigh'],
    ['kanapoolkoib', 'ing-drumstick'],
    ['kanapoolkoivad', 'ing-drumstick'],
    ['kanakoib', 'ing-leg'],
  ])('matches "%s" to %s', async (recipeName, id) => {
    await seedCuts()

    const [result] = await matchIngredients([extracted(recipeName)], 4, { locale: 'et' })

    expect(result).toMatchObject({ type: 'matched', ingredient: { id } })
  })
})

// HON-1480: a bare meat or fish row is on the bone or whole, so a boneless line
// must find the fillet row of the same cut, and a bone-in or whole line the bare row.
// Every seeded protein row is in the catalogue, so its real neighbours compete.
describe('matchIngredients on a bone-in, boneless or whole cut', () => {
  async function seedCuts() {
    const names = new Set<string>()
    const rows = [
      ...baseIngredients,
      ...newIngredients,
      ...comprehensiveIngredients,
      ...importCoverageIngredients,
    ].filter((row) => row.category === 'protein' && !names.has(row.name) && names.add(row.name))

    // A migration may have inserted a row already, so its id is read back by name
    await prisma.ingredient.createMany({
      data: rows.map((row) => ({
        name: row.name,
        category: 'protein',
        defaultUnit: 'g',
        calories: row.calories,
        protein: row.protein,
        carbs: row.carbs,
        fat: row.fat,
      })),
      skipDuplicates: true,
    })
    const saved = await prisma.ingredient.findMany({
      where: { householdId: null, name: { in: [...names] } },
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

  it.each([
    ['chicken thighs', 'chicken thigh'],
    ['bone-in skin-on chicken thighs', 'chicken thigh'],
    ['boneless skinless chicken thighs', 'chicken thigh fillet'],
    ['chicken thigh fillets', 'chicken thigh fillet'],
    ['chicken thigh meat', 'chicken thigh fillet'],
    ['boneless chicken thigh', 'chicken thigh fillet'],
    ['thigh fillets', 'chicken thigh fillet'],
    ['kanakintsud', 'chicken thigh'],
    ['kanakintsuliha', 'chicken thigh fillet'],
    ['kintsufilee', 'chicken thigh fillet'],
    ['kanakintsufilee', 'chicken thigh fillet'],
    ['kanapoolkoivad', 'chicken drumstick'],
    ['whole chicken', 'whole chicken'],
    ['whole trout', 'trout'],
    ['trout fillets', 'trout fillet'],
    ['forell', 'trout'],
    ['forellifilee', 'trout fillet'],
    ['boneless pork chop', 'pork chop'],
    ['deboned chicken thighs', 'chicken thigh fillet'],
    // A word that names no cut keeps a fillet row sure (HON-1480 review)
    ['wild salmon fillets', 'salmon fillet'],
    ['atlantic salmon fillet', 'salmon fillet'],
    ['salmon fillet portions', 'salmon fillet'],
  ])('matches "%s" to the seeded row %s, sure', async (recipeName, rowName) => {
    await seedCuts()

    const [result] = await matchIngredients([extracted(recipeName)], 4, { locale: 'et' })

    expect(result).toMatchObject({
      type: 'matched',
      ingredient: { name: rowName },
      lowConfidence: false,
    })
  })
  // A name the prompts no longer ask for, but a model can still write (HON-1480 review)
  it.each([
    ['beef chuck fillet', 'beef fillet'],
    ['pork chop fillet', 'pork fillet'],
    ['lamb leg fillet', 'lamb fillet'],
    ['chicken leg fillet', 'chicken fillet'],
  ])('does not match "%s" to %s for sure', async (recipeName, otherCut) => {
    await seedCuts()

    const [result] = await matchIngredients([extracted(recipeName)], 4, { locale: 'et' })

    expect(result).not.toMatchObject({ ingredient: { name: otherCut }, lowConfidence: false })
  })
})
