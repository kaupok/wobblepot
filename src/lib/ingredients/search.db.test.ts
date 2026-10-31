import { describe, expect, it } from 'vitest'

import { type IngredientSearch, searchIngredients, SYNONYM_SCORE } from '@/lib/ingredients/search'
import { prisma } from '@/lib/prisma'

import { importCoverageIngredients } from '../../../prisma/seed-import-coverage'
import { ingredientTranslationsEt } from '../../../prisma/seed-ingredient-translations-et'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks:
// the real `similarity()` from pg_trgm. The migrations seed only part of the
// global pool (none of the rows below), so each test adds the global rows it
// names, beside the seeded ones ("self-raising flour", "teff flour", …).

const nutrition = { calories: 0, protein: 0, carbs: 0, fat: 0 }

const POOL = {
  potato: 'vegetable',
  'plain flour': 'carb',
  courgette: 'vegetable',
  aubergine: 'vegetable',
  egg: 'protein',
  'egg noodles': 'carb',
} as const

/** Adds a global row named `name`, the way the seed adds pool rows; returns its id. */
async function poolId(name: keyof typeof POOL) {
  const row = await prisma.ingredient.create({
    data: { name, category: POOL[name], defaultUnit: 'g', ...nutrition },
    select: { id: true },
  })
  return row.id
}

/** Alder and Birch, each with a custom ingredient named like a dumpling. */
async function world() {
  const alder = await prisma.household.create({ data: { name: 'Alder' } })
  const birch = await prisma.household.create({ data: { name: 'Birch' } })
  await prisma.ingredient.create({
    data: {
      id: 'ing-alder',
      name: 'Alder dumpling',
      category: 'carb',
      defaultUnit: 'g',
      householdId: alder.id,
      ...nutrition,
    },
  })
  await prisma.ingredient.create({
    data: {
      id: 'ing-birch',
      name: 'Birch dumpling',
      category: 'carb',
      defaultUnit: 'g',
      householdId: birch.id,
      ...nutrition,
    },
  })
  return { alder: alder.id, birch: birch.id }
}

const search = (input: Partial<IngredientSearch> & { search: string }) =>
  searchIngredients({ category: null, limit: 10, householdId: null, locale: 'en', ...input })

const ids = (rows: { id: string }[]) => rows.map((row) => row.id)

describe('searchIngredients', () => {
  it('finds a pool ingredient by its English name, best match first', async () => {
    const potato = await poolId('potato')

    const rows = await search({ search: 'potato' })

    expect(rows[0]).toMatchObject({ id: potato, name: 'potato', similarity: 1 })
    expect(rows[0]).not.toHaveProperty('matchedAs')
  })

  // HON-911: an Estonian household types the names it sees on screen.
  it('finds a pool ingredient by its Estonian name and returns that name', async () => {
    const potato = await poolId('potato')
    await prisma.ingredientTranslation.create({
      data: { ingredientId: potato, locale: 'et', name: 'kartul' },
    })

    const rows = await search({ search: 'kartul', locale: 'et' })

    expect(rows[0]).toMatchObject({ id: potato, name: 'kartul', similarity: 1 })
  })

  it('still finds a row by its English name in an Estonian household', async () => {
    const potato = await poolId('potato')
    await prisma.ingredientTranslation.create({
      data: { ingredientId: potato, locale: 'et', name: 'kartul' },
    })

    const rows = await search({ search: 'potato', locale: 'et' })

    expect(rows[0]).toMatchObject({ id: potato, name: 'kartul' })
  })

  it('does not match the Estonian name for an English household', async () => {
    const potato = await poolId('potato')
    await prisma.ingredientTranslation.create({
      data: { ingredientId: potato, locale: 'et', name: 'kartul' },
    })

    expect(ids(await search({ search: 'kartul' }))).not.toContain(potato)
  })

  // HON-889: the write routes reject another household's ingredient.
  it("offers the household's own ingredients, never another household's", async () => {
    const { alder } = await world()

    const found = ids(await search({ search: 'dumpling', householdId: alder }))

    expect(found).toContain('ing-alder')
    expect(found).not.toContain('ing-birch')
  })

  it('offers global ingredients only with no household', async () => {
    await world()

    const found = ids(await search({ search: 'dumpling' }))

    expect(found).not.toContain('ing-alder')
    expect(found).not.toContain('ing-birch')
  })

  it('returns nothing for a term that is like no name', async () => {
    expect(await search({ search: 'qqqxxzz' })).toEqual([])
  })

  it('keeps to the category', async () => {
    await poolId('plain flour')
    const rows = await search({ search: 'flour', category: 'carb', limit: 50 })

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.category === 'carb')).toBe(true)
  })

  it('holds the limit', async () => {
    await poolId('plain flour')
    expect(await search({ search: 'flour', limit: 2 })).toHaveLength(2)
  })

  // HON-1100: a household that types another English name finds the row.
  describe('by another English name', () => {
    it('ranks the row first with matchedAs for a strong synonym prefix', async () => {
      const flour = await poolId('plain flour')

      const rows = await search({ search: 'all-purpose fl' })

      expect(rows[0]).toMatchObject({
        id: flour,
        name: 'plain flour',
        similarity: SYNONYM_SCORE,
        matchedAs: 'all-purpose flour',
      })
    })

    it('ranks a one-word synonym first from four characters', async () => {
      const courgette = await poolId('courgette')

      const rows = await search({ search: 'zucc' })

      expect(rows[0]).toMatchObject({ id: courgette, matchedAs: 'zucchini' })
    })

    // HON-1104: "egg" only starts "eggplant", a weak hit, so the egg rows stay on top.
    it('ranks the name hits above a one-word synonym a short term starts', async () => {
      const aubergine = await poolId('aubergine')
      const egg = await poolId('egg')
      await poolId('egg noodles')

      const rows = await search({ search: 'egg' })

      const at = ids(rows).indexOf(aubergine)
      expect(rows[0]).toMatchObject({ id: egg, similarity: 1 })
      expect(at).toBeGreaterThan(0)
      expect(rows[at]).toMatchObject({ matchedAs: 'eggplant' })
      expect(rows[at]!.similarity).toBeLessThan(SYNONYM_SCORE)
    })

    it('returns the Estonian display name with the English synonym', async () => {
      const flour = await poolId('plain flour')
      await prisma.ingredientTranslation.create({
        data: { ingredientId: flour, locale: 'et', name: 'nisujahu' },
      })

      const rows = await search({ search: 'all-purpose flour', locale: 'et' })

      expect(rows[0]).toMatchObject({
        id: flour,
        name: 'nisujahu',
        matchedAs: 'all-purpose flour',
      })
    })

    it('applies the category filter to the synonym rows', async () => {
      const courgette = await poolId('courgette')

      expect(ids(await search({ search: 'zucc', category: 'fruit' }))).not.toContain(courgette)
    })

    it("never offers a household's ingredient by a synonym of its name", async () => {
      const alder = await prisma.household.create({ data: { name: 'Alder' } })
      await prisma.ingredient.create({
        data: {
          id: 'ing-own-courgette',
          name: 'courgette',
          category: 'vegetable',
          defaultUnit: 'g',
          householdId: alder.id,
          ...nutrition,
        },
      })

      const rows = await search({ search: 'zucc', householdId: alder.id })

      expect(rows.find((row) => row.id === 'ing-own-courgette')).toBeUndefined()
    })
  })
})

// HON-1471: a shopper or an assistant types the shelf name of a frozen bag.
describe('searchIngredients on the frozen form rows of the seed', () => {
  async function seedFrozenRows() {
    for (const row of importCoverageIngredients.filter((r) => r.name.startsWith('frozen '))) {
      const et = ingredientTranslationsEt.find((t) => t.en === row.name)!.et
      await prisma.ingredient.create({
        data: {
          name: row.name,
          category: row.category,
          defaultUnit: row.defaultUnit,
          ...nutrition,
          translations: { create: { locale: 'et', name: et } },
        },
      })
    }
  }

  it.each([
    ['frozen peas', 'en', 'frozen peas'],
    ['külmutatud herned', 'et', 'külmutatud herned'],
    ['brokoli-lillkapsasegu', 'et', 'külmutatud brokoli-lillkapsasegu'],
    ['marjasegu', 'et', 'külmutatud marjasegu'],
  ])('finds "%s" (%s) as %s, best match first', async (query, locale, shown) => {
    await seedFrozenRows()

    const rows = await search({ search: query, locale: locale as 'en' | 'et' })

    expect(rows[0]).toMatchObject({ name: shown })
  })
})

// HON-1496: an Estonian cook types the name of a baking flour.
describe('searchIngredients on the grain flour rows of the seed', () => {
  async function seedFlourRows() {
    const names = [
      'oat flour',
      'rye flour',
      'buckwheat flour',
      'barley flour',
      'oats',
      'plain flour',
    ]
    for (const name of names) {
      const et = ingredientTranslationsEt.find((t) => t.en === name)!.et
      await prisma.ingredient.create({
        data: {
          id: `ing-${name.replace(' ', '-')}`,
          name,
          category: 'carb',
          defaultUnit: 'g',
          ...nutrition,
          translations: { create: { locale: 'et', name: et } },
        },
      })
    }
  }

  it.each([
    ['kaerajahu', 'ing-oat-flour', 'kaerajahu'],
    ['rukkijahu', 'ing-rye-flour', 'rukkijahu'],
    ['tatrajahu', 'ing-buckwheat-flour', 'tatrajahu'],
    ['odrajahu', 'ing-barley-flour', 'odrajahu'],
  ])('finds "%s" in Estonian as %s, best match first', async (query, id, shown) => {
    await seedFlourRows()

    const rows = await search({ search: query, locale: 'et' })

    expect(rows[0]).toMatchObject({ id, name: shown })
  })
})
