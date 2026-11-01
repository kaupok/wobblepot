import { describe, expect, it } from 'vitest'

import { runTool, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { prisma } from '@/lib/prisma'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'

import { addShoppingItem } from './add-shopping-item'
import { addToPantry } from './add-to-pantry'
import { getPantry } from './get-pantry'
import { setPantryStatus } from './set-pantry-status'

// Runs against PGlite with pg_trgm through the `unit-db` project, with no
// mocks: the real matcher finds each ingredient, `pantry-items.ts` writes it,
// and the pantry is read back through get_pantry and the rows (HON-1497).
//
// The migrations seed a shared catalogue, so the ingredient names here are
// invented words that match no seeded ingredient.

const CALLER = { userId: 'user-1' }

/**
 * Alder (English) holds 300 g of hush oats, and snorvelgrain as a staple that
 * ran out. Glimmer rice is "glimmeri riis" in Estonian. A zorbleplum weighs
 * 130 g and is counted in pieces; a quafflenut is counted in pieces with no
 * known weight. Brindleberry jam and quorvex paste are Alder's own, so
 * "brindleberry jelly" is an unsure match and "quorvax pasta" has none.
 * Plinkvortex sauce is Birch's own.
 */
async function world() {
  const household = async (name: string, locale: string) => {
    const row = await prisma.household.create({
      data: { name, locale, timezone: 'Europe/Tallinn' },
    })
    return mcpHousehold({ id: row.id, locale, timezone: 'Europe/Tallinn' })
  }
  const alder = await household('Alder', 'en')
  const birch = await household('Birch', 'et')
  const ingredient = (id: string, name: string, data: Record<string, unknown> = {}) =>
    prisma.ingredient.create({
      data: {
        id,
        name,
        category: 'carb',
        defaultUnit: 'g',
        calories: 100,
        protein: 0,
        carbs: 0,
        fat: 0,
        ...data,
      },
    })
  await ingredient('ing-rice', 'glimmer rice', {
    translations: { create: { locale: 'et', name: 'glimmeri riis' } },
  })
  await ingredient('ing-oats', 'hush oats')
  await ingredient('ing-grain', 'snorvelgrain')
  await ingredient('ing-plum', 'zorbleplum', { defaultUnit: 'piece', gramsPerPiece: 130 })
  await ingredient('ing-nut', 'quafflenut', { defaultUnit: 'piece', gramsPerPiece: null })
  await ingredient('ing-jam', 'brindleberry jam', { householdId: alder.id })
  await ingredient('ing-paste', 'quorvex paste', { householdId: alder.id })
  await ingredient('ing-sauce', 'plinkvortex sauce', { householdId: birch.id })
  await prisma.pantryItem.createMany({
    data: [
      { householdId: alder.id, ingredientId: 'ing-oats', quantity: 300, isStaple: false },
      { householdId: alder.id, ingredientId: 'ing-grain', quantity: 0, isStaple: true },
    ],
  })
  return { alder, birch }
}

type Household = Awaited<ReturnType<typeof world>>['alder']

function call(household: Household, items: Record<string, unknown>[]) {
  return addToPantry.run(household, addToPantry.inputSchema.parse({ items }), CALLER)
}

/** The item as an assistant sees it, through get_pantry. */
async function pantryItem(household: Household, ingredientId: string) {
  const { items } = await getPantry.run(household, {}, CALLER)
  return items.find((i) => i.ingredientId === ingredientId)
}

const NOT_SAVED = { item: null, previous: null, amountDropped: false, check: null }

describe('add_to_pantry', () => {
  it('saves new items with their amounts, a weight for a piece ingredient as pieces', async () => {
    const { alder } = await world()

    const result = await call(alder, [
      { name: 'glimmer rice', quantity: 1000, unit: 'g' },
      { name: 'zorbleplum', quantity: 800, unit: 'g' },
    ])

    expect(result.items).toEqual([
      {
        name: 'glimmer rice',
        outcome: 'saved',
        item: {
          ingredientId: 'ing-rice',
          name: 'glimmer rice',
          quantity: 1000,
          unit: 'g',
          isStaple: false,
        },
        previous: null,
        amountDropped: false,
        check: null,
        candidates: [],
      },
      {
        name: 'zorbleplum',
        outcome: 'saved',
        // 800 g at 130 g a piece
        item: {
          ingredientId: 'ing-plum',
          name: 'zorbleplum',
          quantity: 6.2,
          unit: 'piece',
          isStaple: false,
        },
        previous: null,
        amountDropped: false,
        check: null,
        candidates: [],
      },
    ])
    const pantry = await getPantry.run(alder, {}, CALLER)
    expect(pantry.items.find((i) => i.ingredientId === 'ing-rice')?.quantity).toBe(1000)
    expect(pantry.items.find((i) => i.ingredientId === 'ing-plum')?.quantity).toBe(6.2)
  })

  it('adds an amount to the amount at home and reports the one before', async () => {
    const { alder } = await world()

    const [result] = (await call(alder, [{ name: 'hush oats', quantity: 500, unit: 'g' }])).items

    expect(result).toMatchObject({
      outcome: 'saved',
      item: { ingredientId: 'ing-oats', quantity: 800 },
      previous: { quantity: 300 },
    })
    expect((await pantryItem(alder, 'ing-oats'))?.quantity).toBe(800)
  })

  it('clears a running-low mark on an item bought again (HON-1586)', async () => {
    const { alder } = await world()
    await prisma.pantryItem.updateMany({
      where: { householdId: alder.id, ingredientId: 'ing-oats' },
      data: { lowAt: new Date() },
    })

    await call(alder, [{ name: 'hush oats', quantity: 500, unit: 'g' }])

    expect(await pantryItem(alder, 'ing-oats')).toMatchObject({ quantity: 800, low: false })
  })

  it('adds up two lines for one ingredient', async () => {
    const { alder } = await world()

    const result = await call(alder, [
      { name: 'glimmer rice', quantity: 500, unit: 'g' },
      { name: 'glimmer rice', quantity: 250, unit: 'g' },
    ])

    expect(result.items.map((i) => i.item?.quantity)).toEqual([500, 750])
    expect((await pantryItem(alder, 'ing-rice'))?.quantity).toBe(750)
  })

  it('saves an item with no amount as have some, amount unknown', async () => {
    const { alder } = await world()

    const result = await call(alder, [{ name: 'hush oats' }, { name: 'glimmer rice' }])

    expect(result.items.map((i) => [i.item?.quantity, i.previous])).toEqual([
      [null, { quantity: 300 }],
      [null, null],
    ])
    expect((await pantryItem(alder, 'ing-oats'))?.quantity).toBeNull()
    expect((await pantryItem(alder, 'ing-rice'))?.quantity).toBeNull()
  })

  it('saves a staple as have some and says the amount was dropped', async () => {
    const { alder } = await world()

    const [result] = (await call(alder, [{ name: 'snorvelgrain', quantity: 1000, unit: 'g' }]))
      .items

    expect(result).toMatchObject({
      outcome: 'saved',
      item: { ingredientId: 'ing-grain', quantity: null, isStaple: true },
      previous: { quantity: 0 },
      amountDropped: true,
    })
    expect(await pantryItem(alder, 'ing-grain')).toMatchObject({ quantity: null, isStaple: true })
  })

  it('saves a staple of unknown piece weight with no check, since its amount is dropped', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-nut', quantity: 0, isStaple: true },
    })

    const [result] = (await call(alder, [{ name: 'quafflenut', quantity: 300, unit: 'g' }])).items

    expect(result).toMatchObject({
      outcome: 'saved',
      item: { ingredientId: 'ing-nut', quantity: null, isStaple: true },
      amountDropped: true,
      check: null,
    })
  })

  it('saves nothing for an unsure or unknown name, and still saves the rest', async () => {
    const { alder } = await world()

    const result = await call(alder, [
      { name: 'brindleberry jelly', quantity: 200, unit: 'g' },
      { name: 'quorvax pasta' },
      { name: 'glimmer rice', quantity: 1000, unit: 'g' },
    ])

    expect(result.items.slice(0, 2)).toEqual([
      {
        name: 'brindleberry jelly',
        outcome: 'unsure',
        ...NOT_SAVED,
        candidates: [{ ingredientId: 'ing-jam', name: 'brindleberry jam' }],
      },
      {
        name: 'quorvax pasta',
        outcome: 'unmatched',
        ...NOT_SAVED,
        candidates: [{ ingredientId: 'ing-paste', name: 'quorvex paste' }],
      },
    ])
    expect(result.items[2]?.outcome).toBe('saved')
    expect(await pantryItem(alder, 'ing-jam')).toBeUndefined()
    expect(await pantryItem(alder, 'ing-paste')).toBeUndefined()
    expect((await pantryItem(alder, 'ing-rice'))?.quantity).toBe(1000)
  })

  it('takes the ingredientId over the name, as a retry after unsure does', async () => {
    const { alder } = await world()

    const [result] = (
      await call(alder, [
        { name: 'brindleberry jelly', ingredientId: 'ing-jam', quantity: 200, unit: 'g' },
      ])
    ).items

    expect(result).toMatchObject({
      name: 'brindleberry jelly',
      outcome: 'saved',
      item: { ingredientId: 'ing-jam', name: 'brindleberry jam', quantity: 200 },
    })
  })

  it("saves nothing for another household's ingredientId", async () => {
    const { alder } = await world()

    const [result] = (await call(alder, [{ name: 'plinkvortex sauce', ingredientId: 'ing-sauce' }]))
      .items

    expect(result).toEqual({
      name: 'plinkvortex sauce',
      outcome: 'unknown_id',
      ...NOT_SAVED,
      candidates: [],
    })
    expect(await pantryItem(alder, 'ing-sauce')).toBeUndefined()
  })

  it('asks for a check when a weight meets a piece ingredient of unknown weight', async () => {
    const { alder } = await world()

    const [result] = (await call(alder, [{ name: 'quafflenut', quantity: 300, unit: 'g' }])).items

    expect(result).toEqual({
      name: 'quafflenut',
      outcome: 'check_quantity',
      item: null,
      previous: null,
      amountDropped: false,
      check: {
        ingredientId: 'ing-nut',
        name: 'quafflenut',
        quantity: 300,
        unit: 'piece',
        warning:
          'Wobblepot does not know what one piece of quafflenut weighs, so 300 g became 300 piece by a guess.',
      },
      candidates: [],
    })
    expect(await pantryItem(alder, 'ing-nut')).toBeUndefined()

    const [retry] = (
      await call(alder, [
        { name: 'quafflenut', ingredientId: 'ing-nut', quantity: 4, unit: 'piece' },
      ])
    ).items
    expect(retry?.item).toMatchObject({ ingredientId: 'ing-nut', quantity: 4, unit: 'piece' })
  })

  it('applies no per-serving recipe limit to a large amount', async () => {
    const { alder } = await world()

    const [result] = (await call(alder, [{ name: 'zorbleplum', quantity: 12, unit: 'piece' }]))
      .items

    expect(result?.item).toMatchObject({ ingredientId: 'ing-plum', quantity: 12 })
  })

  it('matches an Estonian name and reports the Estonian name', async () => {
    const { birch } = await world()

    const [result] = (await call(birch, [{ name: 'glimmeri riis', quantity: 500, unit: 'g' }]))
      .items

    expect(result?.item).toMatchObject({ ingredientId: 'ing-rice', name: 'glimmeri riis' })
  })

  it('refuses a read-only token and writes nothing', async () => {
    const { alder } = await world()

    const result = await runTool(
      addToPantry,
      { userId: 'user-1', household: alder, scopes: READ_SCOPES },
      { items: [{ name: 'glimmer rice' }] },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
    })
    expect(await pantryItem(alder, 'ing-rice')).toBeUndefined()
  })

  it('refuses an amount with no unit', () => {
    expect(() =>
      addToPantry.inputSchema.parse({ items: [{ name: 'glimmer rice', quantity: 500 }] }),
    ).toThrow('Give quantity and unit together, or neither.')
  })

  it('is named in the shopping and pantry tools as the way to stock the pantry', () => {
    for (const tool of [setPantryStatus, addShoppingItem]) {
      expect(tool.description).toContain('use add_to_pantry')
    }
  })
})
