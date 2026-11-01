import { describe, expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'

import { baseIngredients } from '../../../prisma/seed'
import { comprehensiveIngredients } from '../../../prisma/seed-comprehensive'
import { newIngredients } from '../../../prisma/seed-expansion'
import { importCoverageIngredients } from '../../../prisma/seed-import-coverage'
import { ingredientTranslationsEt } from '../../../prisma/seed-ingredient-translations-et'
import { matchIngredients } from './match-ingredients'
import { extracted } from './match-ingredients.fixtures'

// Runs against PGlite with pg_trgm through the `unit-db` project, with no mocks, on
// rows taken from the seed: each test names the catalogue rows it needs.

// The seeded rows and Estonian names, so a row that leaves the seed turns a test red
async function seedShopCatalogue(names: string[]) {
  const rows = [
    ...baseIngredients,
    ...newIngredients,
    ...comprehensiveIngredients,
    ...importCoverageIngredients,
  ].filter((row) => names.includes(row.name))
  expect(rows.map((row) => row.name).sort()).toEqual([...names].sort())

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
    where: { householdId: null, name: { in: names } },
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

// HON-1499: an Estonian household enters a grocery delivery by the shop names, so
// each name must find its own row and not fresh fruit, another frozen bag or a squash.
describe('matchIngredients on an Estonian shop name', () => {
  const names = [
    'broccoli',
    'frozen broccoli and cauliflower mix',
    'frozen broccoli',
    'frozen strawberries',
    'mango',
    'dried mango',
    'frozen mango',
    'pumpkin',
    'tinned pumpkin',
    'butternut squash',
    'kabocha squash',
    'courgette',
    'pumpkin seeds',
  ]

  it.each([
    ['külmutatud brokoli', 'frozen broccoli'],
    ['külmutatud mango', 'frozen mango'],
    ['kõrvits', 'pumpkin'],
  ])('matches "%s" to "%s", sure', async (recipeName, name) => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted(recipeName)], 4, { locale: 'et' })

    expect(result).toMatchObject({ type: 'matched', ingredient: { name }, lowConfidence: false })
  })
})

// HON-1545: a shop sells a seed mix, a nut mix and a wok bag as one pack, so each
// mix finds its own row and not one of its parts. "india pähkli või" once saved as
// `butter`, which added dairy and dropped the nut allergen.
describe('matchIngredients on a shop mix or a seed, nut or paste name', () => {
  const names = [
    'seed mix',
    'mixed nuts',
    'frozen stir-fry vegetables',
    'frozen mixed vegetables',
    'frozen mixed berries',
    'sunflower seeds',
    'pumpkin seeds',
    'flax seeds',
    'chia seeds',
    'sesame seeds',
    'sesame oil',
    'tahini',
    'cashews',
    'cashew butter',
    'butter',
    'peanuts',
    'peanut butter',
    'almonds',
    'hazelnuts',
  ]

  it.each([
    ['seemnesegu', 'seed mix'],
    ['pähklisegu', 'mixed nuts'],
    ['wokisegu', 'frozen stir-fry vegetables'],
    ['india pähkli või', 'cashew butter'],
    ['kašupähklivõi', 'cashew butter'],
    ['india pähklid', 'cashews'],
    ['seesamipasta', 'tahini'],
    ['chia seemned', 'chia seeds'],
    ['marjasegu', 'frozen mixed berries'],
    ['päevalilleseemned', 'sunflower seeds'],
    ['kõrvitsaseemned', 'pumpkin seeds'],
    ['külmutatud köögiviljasegu', 'frozen mixed vegetables'],
  ])('matches the Estonian "%s" to "%s", sure', async (recipeName, name) => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted(recipeName)], 4, { locale: 'et' })

    expect(result).toMatchObject({ type: 'matched', ingredient: { name }, lowConfidence: false })
  })

  it.each([
    ['mixed seeds', 'seed mix'],
    ['mixed nuts', 'mixed nuts'],
    ['linseeds', 'flax seeds'],
    ['sesame', 'sesame seeds'],
  ])('matches the English "%s" to "%s", sure', async (recipeName, name) => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted(recipeName)], 4)

    expect(result).toMatchObject({ type: 'matched', ingredient: { name }, lowConfidence: false })
  })

  it.each([
    ['seemnesegu', 'sunflower seeds'],
    ['pähklisegu', 'cashews'],
  ])('does not match the mix "%s" to its part "%s"', async (recipeName, part) => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted(recipeName)], 4, { locale: 'et' })

    expect(result).not.toMatchObject({ ingredient: { name: part } })
  })
})

// HON-1546: a nut butter or a plant milk with no row of its own once found the bare
// `butter` or `milk` through its last word, sure, so it saved as dairy with no nut
// allergen. A guess for a qualified name goes to the user as unsure instead.
describe('matchIngredients on a qualified name whose own row is missing', () => {
  const names = ['butter', 'milk', 'walnuts', 'bread']

  it.each([
    ['walnut butter', 'butter'],
    ['macadamia milk', 'milk'],
    // A short qualifier finds `butter` in the direct search, above the fallback's threshold
    ['nut butter', 'butter'],
  ])('returns "%s" unsure, with "%s" as an alternative', async (recipeName, name) => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted(recipeName)], 4)

    expect(result).toMatchObject({ type: 'matched', lowConfidence: true })
    const alternatives = result!.type === 'matched' ? result!.alternatives : undefined
    expect(alternatives?.map((row) => row.name)).toContain(name)
  })

  it('does not save the Estonian "kašu või" as a sure `butter`', async () => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted('kašu või')], 4, { locale: 'et' })

    expect(result).not.toMatchObject({
      type: 'matched',
      ingredient: { name: 'butter' },
      lowConfidence: false,
    })
  })

  it('keeps "bread" a sure match for `bread`', async () => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted('bread')], 4)

    expect(result).toMatchObject({
      type: 'matched',
      ingredient: { name: 'bread' },
      lowConfidence: false,
    })
  })
})
