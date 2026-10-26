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
  const birch = await prisma.household.create({ data: { name: 'Birch' } })
  const rows = {
    mushroom: await ingredient('mushroom', 'seen'),
    shiitake: await ingredient('shiitake mushroom', 'šiitake'),
    chestnut: await ingredient('chestnut mushroom', 'pruun šampinjon'),
    porkMince: await ingredient('pork mince', 'seahakkliha'),
    porkBelly: await ingredient('pork belly', 'seakõht'),
    egg: await ingredient('egg', 'muna'),
    aubergine: await ingredient('aubergine', 'baklažaan'),
    nutmeg: await ingredient('nutmeg', 'muskaatpähkel'),
    alderMushroom: await ingredient('Grandma pickled mushrooms', undefined, alder.id),
    birchMushroom: await ingredient('Birch mushroom mix', undefined, birch.id),
  }
  return { alder, rows }
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
    expect(nut).not.toContain(rows.nutmeg.id)
  })

  it('excludes the same rows for the Estonian name as for the English name', async () => {
    const { alder } = await world()

    const english = await getExcludedIngredientIds(alder.id, ['mushroom'])

    expect((await getExcludedIngredientIds(alder.id, ['seen'])).sort()).toEqual(english.sort())
    expect((await getExcludedIngredientIds(alder.id, ['seened'])).sort()).toEqual(english.sort())
  })

  it('excludes nothing for a name no ingredient carries', async () => {
    const { alder } = await world()

    expect(await getExcludedIngredientIds(alder.id, ['dragonfruit'])).toEqual([])
    expect(await getExcludedIngredientIds(alder.id, [])).toEqual([])
  })
})

describe('matchExcludedIngredients', () => {
  it('lists each tag with its matches in the locale, and an empty list for no match', async () => {
    const { alder } = await world()

    const matches = await matchExcludedIngredients(alder.id, ['shiitake', 'dragonfruit'], 'et')

    expect(matches).toEqual([
      { tag: 'shiitake', ingredients: [expect.objectContaining({ name: 'šiitake' })] },
      { tag: 'dragonfruit', ingredients: [] },
    ])
  })
})
