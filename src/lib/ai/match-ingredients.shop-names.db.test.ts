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
// Each shop name must find its own seeded row, through its Estonian name or a synonym.

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

// HON-1548: kama and grain flakes are Estonian breakfast staples, and a pantry
// photo saved them as unmatched or as the whole grain. A flake, a flour and the
// grain each keep their own row.
describe('matchIngredients on kama, grain flakes, spelt flour or cacao nibs', () => {
  const names = [
    'cacao nibs',
    'kama',
    'buckwheat kama',
    'millet flakes',
    'rye flakes',
    'buckwheat flakes',
    'four-grain flakes',
    'millet',
    'buckwheat',
    'buckwheat flour',
    'rye flour',
    'rolled oats',
    'cocoa powder',
    'spelt flour',
    'spelt',
  ]

  it.each([
    ['toorkakao tuumad', 'cacao nibs'],
    ['kakaonibsid', 'cacao nibs'],
    ['kama', 'kama'],
    ['toor-tatra kama', 'buckwheat kama'],
    ['toortatra kama', 'buckwheat kama'],
    ['tatrakama', 'buckwheat kama'],
    ['hirsihelbed', 'millet flakes'],
    ['rukkihelbed', 'rye flakes'],
    ['tatrahelbed', 'buckwheat flakes'],
    ['neljaviljahelbed', 'four-grain flakes'],
    ['4-vilja helbed', 'four-grain flakes'],
    ['speltajahu', 'spelt flour'],
    ['speltanisujahu', 'spelt flour'],
    ['speltanisu', 'spelt'],
    ['hirss', 'millet'],
    ['tatar', 'buckwheat'],
    ['tatrajahu', 'buckwheat flour'],
    ['kakaopulber', 'cocoa powder'],
  ])('matches the Estonian "%s" to "%s", sure', async (recipeName, name) => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted(recipeName)], 4, { locale: 'et' })

    expect(result).toMatchObject({ type: 'matched', ingredient: { name }, lowConfidence: false })
  })

  it.each([
    ['cacao nibs', 'cacao nibs'],
    ['cocoa nibs', 'cacao nibs'],
    ['millet flakes', 'millet flakes'],
  ])('matches the English "%s" to "%s", sure', async (recipeName, name) => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted(recipeName)], 4)

    expect(result).toMatchObject({ type: 'matched', ingredient: { name }, lowConfidence: false })
  })

  it.each([
    ['kama', 'buckwheat kama'],
    ['hirsihelbed', 'millet'],
    ['tatrahelbed', 'buckwheat'],
    ['speltajahu', 'spelt'],
  ])('does not match "%s" to "%s"', async (recipeName, other) => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted(recipeName)], 4, { locale: 'et' })

    expect(result).not.toMatchObject({ ingredient: { name: other } })
  })
})

// HON-1546: a nut butter or a plant milk with no row of its own once found the bare
// `butter` or `milk` through its last word, sure, so it saved as dairy with no nut
// allergen. A guess for a qualified name goes to the user as unsure instead.
describe('matchIngredients on a qualified name whose own row is missing', () => {
  const names = ['butter', 'milk', 'walnuts', 'bread', 'peas']

  it.each([
    ['walnut butter', 'butter'],
    ['macadamia milk', 'milk'],
    // A short qualifier finds `butter` in the direct search, above the fallback's threshold
    ['nut butter', 'butter'],
    // A plural bare row is judged in the singular, as the entered name is
    ['wasabi peas', 'peas'],
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

  it.each([
    ['hakitud sibul', 'onion'],
    ['riivitud juust', 'cheese'],
  ])('keeps the Estonian "%s" a sure match for `%s`', async (recipeName, name) => {
    await seedShopCatalogue([...names, 'onion', 'cheese'])

    const [result] = await matchIngredients([extracted(recipeName)], 4, { locale: 'et' })

    expect(result).toMatchObject({ type: 'matched', ingredient: { name }, lowConfidence: false })
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

// HON-1549: dried and tinned beans are different purchases and different amounts,
// so "dried chickpeas" finds its own row and the bare name stays the drained tin.
// A berry the household buys finds its own row and not the fresh or dried one.
describe('matchIngredients on a dried, tinned or berry name', () => {
  const names = [
    'chickpeas',
    'dried chickpeas',
    'kidney beans',
    'dried kidney beans',
    'sweetcorn',
    'tinned sweetcorn',
    'peas',
    'tinned peas',
    'lingonberry',
    'frozen lingonberries',
    'cranberry',
    'dried cranberries',
    'frozen cranberries',
    'blackcurrants',
    'blackberry',
    'brown sugar',
    'granulated sugar',
    'salmon',
    'salmon fillet',
  ]

  it.each([
    ['kikerherned', 'chickpeas'],
    ['kuivatatud kikerherned', 'dried chickpeas'],
    ['külmutatud pohlad', 'frozen lingonberries'],
    ['mustsõstrad', 'blackcurrants'],
  ])('matches the Estonian "%s" to "%s", sure', async (recipeName, name) => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted(recipeName)], 4, { locale: 'et' })

    expect(result).toMatchObject({ type: 'matched', ingredient: { name }, lowConfidence: false })
  })

  it.each([
    ['dried chickpeas', 'dried chickpeas'],
    ['canned chickpeas', 'chickpeas'],
    ['chickpeas, drained', 'chickpeas'],
    ['chickpeas, dried', 'dried chickpeas'],
    ['kidney beans, dried and soaked', 'dried kidney beans'],
    ['sweetcorn, tinned', 'tinned sweetcorn'],
  ])('matches the English "%s" to "%s", sure', async (recipeName, name) => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted(recipeName)], 4)

    expect(result).toMatchObject({ type: 'matched', ingredient: { name }, lowConfidence: false })
  })

  // A note that names the variety or the cut is part of the food, so it is not dropped
  it.each([
    ['sugar, brown', 'brown sugar'],
    ['salmon, fillet', 'salmon fillet'],
  ])('keeps the note in "%s", so it matches "%s"', async (recipeName, name) => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted(recipeName)], 4)

    expect(result).toMatchObject({ type: 'matched', ingredient: { name } })
  })
})

// HON-1553: a household entered its spice rack by the shop names, and
// "suitsutatud paprika" saved as the fresh bell pepper. Each blend, sugar and
// pickle finds its own row, and the bare food still wins its own name.
describe('matchIngredients on a spice-rack or pickle-shelf name', () => {
  const names = [
    'lemon pepper seasoning',
    'black pepper',
    'curry powder',
    'curry paste',
    'curry leaves',
    'smoked paprika',
    'paprika',
    'bell pepper',
    'taco seasoning',
    'fajita seasoning',
    'ground ginger',
    'ginger',
    'chicken seasoning',
    'grill seasoning',
    'meat seasoning',
    'fish seasoning',
    'vegetable seasoning',
    'vanilla sugar',
    'vanilla pod',
    'granulated sugar',
    'pickled gherkins',
    'cucumber',
    'crispy fried onions',
    'onion',
  ]

  it.each([
    ['sidrunipipar', 'lemon pepper seasoning'],
    ['karri', 'curry powder'],
    ['suitsutatud paprika', 'smoked paprika'],
    ['taco maitseaine', 'taco seasoning'],
    ['ingveripulber', 'ground ginger'],
    ['kanamaitseaine', 'chicken seasoning'],
    ['grillmaitseaine', 'grill seasoning'],
    ['vanillisuhkur', 'vanilla sugar'],
    ['hapukurk', 'pickled gherkins'],
    ['marineeritud kurk', 'pickled gherkins'],
    ['röstitud sibul', 'crispy fried onions'],
  ])('matches the Estonian "%s" to "%s", sure', async (recipeName, name) => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted(recipeName)], 4, { locale: 'et' })

    expect(result).toMatchObject({ type: 'matched', ingredient: { name }, lowConfidence: false })
  })

  it.each([
    ['lemon pepper', 'lemon pepper seasoning'],
    ['curry', 'curry powder'],
    ['pickles', 'pickled gherkins'],
  ])('matches the English "%s" to "%s", sure', async (recipeName, name) => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted(recipeName)], 4)

    expect(result).toMatchObject({ type: 'matched', ingredient: { name }, lowConfidence: false })
  })

  it.each([
    ['paprika', 'bell pepper'],
    ['paprikapulber', 'paprika'],
    ['kurk', 'cucumber'],
    ['sibul', 'onion'],
    ['suhkur', 'granulated sugar'],
    ['karripasta', 'curry paste'],
    ['karrilehed', 'curry leaves'],
  ])('still matches the bare "%s" to "%s"', async (recipeName, name) => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted(recipeName)], 4, { locale: 'et' })

    expect(result).toMatchObject({ type: 'matched', ingredient: { name } })
  })

  // A recipe's fried onion is onion from the pan, not the gluten-flagged shop topping
  it.each([
    ['praetud sibul', 'et'],
    ['fried onions', 'en'],
  ] as const)('does not save "%s" as a sure `crispy fried onions`', async (recipeName, locale) => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted(recipeName)], 4, { locale })

    expect(result).not.toMatchObject({
      type: 'matched',
      ingredient: { name: 'crispy fried onions' },
      lowConfidence: false,
    })
  })
})

// HON-1551: an Estonian shop sells the concentrate as "tomatipüree", so the word
// finds `tomato paste` ("tomatipasta"), not passata ("passeeritud tomatid"), which
// is half its strength.
describe('matchIngredients on an Estonian tomato product', () => {
  const names = ['tomato paste', 'passata', 'tomato', 'crushed tomatoes', 'tinned chopped tomatoes']

  it.each([
    ['tomatipüree', 'tomato paste'],
    ['tomatipasta', 'tomato paste'],
    ['passeeritud tomatid', 'passata'],
    ['tomati passata', 'passata'],
  ])('matches the Estonian "%s" to "%s", sure', async (recipeName, name) => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted(recipeName)], 4, { locale: 'et' })

    expect(result).toMatchObject({ type: 'matched', ingredient: { name }, lowConfidence: false })
  })

  it.each([
    ['tomato puree', 'passata'],
    ['tomato purée', 'passata'],
  ])('matches the English "%s" to "%s", sure', async (recipeName, name) => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted(recipeName)], 4)

    expect(result).toMatchObject({ type: 'matched', ingredient: { name }, lowConfidence: false })
  })
})

// HON-1547: the noun check once split on spaces only, so "chia seemned" against the
// translation "chia-seemned" read as a different noun and came back unsure.
describe('matchIngredients on a name typed with a space for its hyphen', () => {
  const names = ['chia seeds', 'black-eyed beans', 'black beans']

  it('matches the Estonian "chia seemned" to "chia seeds", sure, with no synonym', async () => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted('chia seemned')], 4, { locale: 'et' })

    expect(result).toMatchObject({
      type: 'matched',
      ingredient: { name: 'chia seeds' },
      lowConfidence: false,
    })
  })

  it('matches the English "black eyed beans" to "black-eyed beans", sure', async () => {
    await seedShopCatalogue(names)

    const [result] = await matchIngredients([extracted('black eyed beans')], 4)

    expect(result).toMatchObject({
      type: 'matched',
      ingredient: { name: 'black-eyed beans' },
      lowConfidence: false,
    })
  })
})
