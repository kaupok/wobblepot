import { describe, expect, it } from 'vitest'

import { runTool, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { prisma } from '@/lib/prisma'
import { mcpHousehold, READ_SCOPES, WRITE_SCOPES } from '@/test/mcp'

import { addShoppingItem } from './add-shopping-item'

// Runs against PGlite through the `unit-db` project, with no mocks: the tool
// writes through `addCustomShoppingItem` and the rows are read back. How the
// name is matched is covered in `custom-items.db.test.ts` (HON-1498).
//
// The migrations seed a global ingredient pool, so the names here are invented
// words that match no seeded ingredient.

const INGREDIENT = {
  category: 'spice',
  defaultUnit: 'g',
  calories: 1,
  protein: 0,
  carbs: 0,
  fat: 0,
} as const

/** Alder (English) and Birch (Estonian), and `quorbleberry` (et `vimpsumari`). */
async function world() {
  const create = async (id: string, locale: string) => {
    await prisma.household.create({ data: { id, name: id, locale } })
    const household = mcpHousehold({ id, locale })
    return { userId: `user-${id}`, household, scopes: WRITE_SCOPES }
  }
  await prisma.ingredient.create({
    data: {
      ...INGREDIENT,
      id: 'ing-global',
      name: 'quorbleberry',
      translations: { create: { locale: 'et', name: 'vimpsumari' } },
    },
  })
  return { alder: await create('hh-alder', 'en'), birch: await create('hh-birch', 'et') }
}

type Caller = Awaited<ReturnType<typeof world>>['alder']

function call(caller: Caller, name: string) {
  return runTool(addShoppingItem, caller, addShoppingItem.inputSchema.parse({ name }))
}

const items = (householdId: string) =>
  prisma.customShoppingItem.findMany({ where: { householdId } })

describe('add_shopping_item', () => {
  it('answers a read-only token with the reconnect message and writes nothing', async () => {
    const { alder } = await world()

    const result = await call({ ...alder, scopes: READ_SCOPES }, 'quorbleberry')

    expect(result.content).toEqual([{ type: 'text', text: WRITE_SCOPE_MESSAGE }])
    expect(await items('hh-alder')).toEqual([])
  })

  it("adds the trimmed name to the caller's list with its linked ingredient", async () => {
    const { alder } = await world()

    const result = await call(alder, '  quorbleberry ')

    const [row] = await items('hh-alder')
    expect(result.structuredContent).toEqual({
      outcome: 'added',
      item: {
        id: row?.id,
        name: 'quorbleberry',
        checked: false,
        ingredient: { ingredientId: 'ing-global', name: 'quorbleberry' },
      },
    })
    expect(row?.ingredientId).toBe('ing-global')
  })

  it("names the linked ingredient in the household's language", async () => {
    const { birch } = await world()

    const result = await call(birch, 'vimpsumari')

    expect(result.structuredContent).toMatchObject({
      item: { ingredient: { ingredientId: 'ing-global', name: 'vimpsumari' } },
    })
  })

  it('returns a null ingredient for a name that matches none', async () => {
    const { alder } = await world()

    const result = await call(alder, 'zentrafloss')

    expect(result.structuredContent).toMatchObject({
      outcome: 'added',
      item: { name: 'zentrafloss', ingredient: null },
    })
  })

  it('puts a checked item back on the list', async () => {
    const { alder } = await world()
    await prisma.customShoppingItem.create({
      data: { id: 'item-1', householdId: 'hh-alder', name: 'quorbleberry', checked: true },
    })

    const result = await call(alder, 'quorbleberry')

    expect(result.structuredContent).toEqual({
      outcome: 'back_on_list',
      item: { id: 'item-1', name: 'quorbleberry', checked: false, ingredient: null },
    })
    expect((await items('hh-alder')).map((row) => row.checked)).toEqual([false])
  })

  it('changes nothing for an item already on the list, and returns its ingredient', async () => {
    const { birch } = await world()
    await prisma.customShoppingItem.create({
      data: {
        id: 'item-1',
        householdId: 'hh-birch',
        name: 'vimpsumari',
        ingredientId: 'ing-global',
      },
    })

    const result = await call(birch, 'vimpsumari')

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual({
      outcome: 'already_on_list',
      item: {
        id: 'item-1',
        name: 'vimpsumari',
        checked: false,
        ingredient: { ingredientId: 'ing-global', name: 'vimpsumari' },
      },
    })
    expect(await items('hh-birch')).toHaveLength(1)
  })

  it('rejects an empty name', () => {
    expect(() => addShoppingItem.inputSchema.parse({ name: '   ' })).toThrow()
  })
})
