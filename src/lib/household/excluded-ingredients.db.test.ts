import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  getExcludedIngredientIds,
  matchExcludedIngredients,
} from '@/lib/household/excluded-ingredients'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.
// The migrations seed part of the global pool, so each test asserts on the
// rows it adds, not on the whole result.

const nutrition = { calories: 0, protein: 0, carbs: 0, fat: 0 }

/** Adds an ingredient, global unless `householdId` is set, with an optional Estonian name. */
async function ingredient(name: string, et?: string, householdId: string | null = null) {
  return prisma.ingredient.create({
    data: {
      name,
      householdId,
      category: 'vegetable',
      defaultUnit: 'g',
      ...nutrition,
      ...(et ? { translations: { create: { locale: 'et', name: et } } } : {}),
    },
    select: { id: true, name: true },
  })
}

async function world() {
  const alder = await prisma.household.create({ data: { name: 'Alder' } })
  const birch = await prisma.household.create({ data: { name: 'Birch', locale: 'et' } })
  const rows = {
    mushroom: await ingredient('mushroom', 'seen'),
    shiitake: await ingredient('shiitake mushroom', 'šiitake'),
    chestnut: await ingredient('chestnut mushroom', 'pruun šampinjon'),
    porkMince: await ingredient('pork mince', 'seahakkliha'),
    porkBelly: await ingredient('pork belly', 'seakõht'),
    paprika: await ingredient('paprika', 'paprikapulber'),
    bellPepper: await ingredient('bell pepper', 'paprika'),
    egg: await ingredient('egg', 'muna'),
    aubergine: await ingredient('aubergine', 'baklažaan'),
    nutmeg: await ingredient('nutmeg', 'muskaatpähkel'),
    alderMushroom: await ingredient('Grandma pickled mushrooms', undefined, alder.id),
    // The pool calls it aubergine (HON-1097); a household may still add "eggplant".
    alderEggplant: await ingredient('eggplant', undefined, alder.id),
    birchMushroom: await ingredient('Birch mushroom mix', undefined, birch.id),
  }
  return { alder, birch, rows }
}

describe('getExcludedIngredientIds', () => {
  it('reads a plural as its singular and excludes the whole family', async () => {
    const { alder, rows } = await world()

    const ids = await getExcludedIngredientIds(alder.id, ['mushrooms'])

    expect(ids).toEqual(
      expect.arrayContaining([
        rows.mushroom.id,
        rows.shiitake.id,
        rows.chestnut.id,
        rows.alderMushroom.id,
      ]),
    )
  })

  it("never matches another household's ingredients", async () => {
    const { alder, rows } = await world()

    expect(await getExcludedIngredientIds(alder.id, ['mushroom'])).not.toContain(
      rows.birchMushroom.id,
    )
  })

  // The migrations seed "smoked sausage" but not "frankfurter", whose name
  // has no "sausage" in it.
  it('excludes frankfurter for "sausage", through the ingredient group', async () => {
    const { alder, birch } = await world()
    const frankfurter = await ingredient('frankfurter', 'viiner')
    const smoked = await prisma.ingredient.findFirstOrThrow({
      where: { householdId: null, name: 'smoked sausage' },
      select: { id: true },
    })

    const sausage = [frankfurter.id, smoked.id]
    expect(await getExcludedIngredientIds(alder.id, ['sausage'])).toEqual(
      expect.arrayContaining(sausage),
    )
    expect(await getExcludedIngredientIds(birch.id, ['vorst'])).toEqual(
      expect.arrayContaining(sausage),
    )
  })

  it('excludes every pork cut for "pork"', async () => {
    const { alder, rows } = await world()

    expect(await getExcludedIngredientIds(alder.id, ['pork'])).toEqual(
      expect.arrayContaining([rows.porkMince.id, rows.porkBelly.id]),
    )
  })

  it('matches whole words only', async () => {
    const { alder, rows } = await world()

    const egg = await getExcludedIngredientIds(alder.id, ['egg'])
    const nut = await getExcludedIngredientIds(alder.id, ['nut'])

    expect(egg).toContain(rows.egg.id)
    expect(egg).not.toContain(rows.aubergine.id)
    expect(egg).not.toContain(rows.alderEggplant.id)
    expect(nut).not.toContain(rows.nutmeg.id)
  })

  it('excludes the same rows for the Estonian name as for the English name', async () => {
    const { alder } = await world()

    const english = await getExcludedIngredientIds(alder.id, ['mushroom'])

    expect((await getExcludedIngredientIds(alder.id, ['seen'])).sort()).toEqual(english.sort())
    expect((await getExcludedIngredientIds(alder.id, ['seened'])).sort()).toEqual(english.sort())
  })

  // "paprika" is the spice in English and bell pepper in Estonian.
  it("reads a name that is also an Estonian word in the household's language", async () => {
    const { alder, birch, rows } = await world()

    const english = await getExcludedIngredientIds(alder.id, ['paprika'])
    const estonian = await getExcludedIngredientIds(birch.id, ['paprika'])

    expect(english).toContain(rows.paprika.id)
    expect(english).not.toContain(rows.bellPepper.id)
    expect(estonian).toEqual(expect.arrayContaining([rows.paprika.id, rows.bellPepper.id]))
  })

  it('excludes nothing for a name no ingredient carries', async () => {
    const { alder } = await world()

    expect(await getExcludedIngredientIds(alder.id, ['dragonfruit'])).toEqual([])
    expect(await getExcludedIngredientIds(alder.id, [])).toEqual([])
  })
})

describe('matchExcludedIngredients', () => {
  it("lists each tag with its matches in the household's locale, and an empty list for no match", async () => {
    const { birch } = await world()

    const matches = await matchExcludedIngredients(birch.id, ['shiitake', 'dragonfruit'])

    expect(matches).toEqual([
      { tag: 'shiitake', ingredients: [expect.objectContaining({ name: 'šiitake' })] },
      { tag: 'dragonfruit', ingredients: [] },
    ])
  })
})
