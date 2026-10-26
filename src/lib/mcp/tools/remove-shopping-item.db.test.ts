import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createDayExtra } from '@/lib/day-extras/day-extras'
import { runTool, ToolInputError, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'
import { getShoppingList } from './get-shopping-list'
import { removeShoppingItem } from './remove-shopping-item'

// Runs against PGlite through the `unit-db` project, with no mocks: the items
// are written with Prisma or `createDayExtra` and the rows are read back
// (HON-1332).
//
// The migrations seed a global ingredient pool, so the item names here are
// invented words that match no seeded ingredient.

// Thursday 15 October 2026, noon in Tallinn: Saturday is 17 October.
const NOW = new Date('2026-10-15T09:00:00Z')
const SATURDAY = '2026-10-17'
const CALLER = { userId: 'user-1' }
const NOT_FOUND = 'No item with this id. Use get_shopping_list to find it. Nothing was changed.'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

/** Alder and Birch, in Tallinn, each with one item added by hand. */
async function world() {
  const household = async (name: string, itemName: string) => {
    const row = await prisma.household.create({
      data: { name, locale: 'en', timezone: 'Europe/Tallinn' },
    })
    const item = await prisma.customShoppingItem.create({
      data: { householdId: row.id, name: itemName },
    })
    const view = mcpHousehold({ id: row.id, locale: 'en', timezone: 'Europe/Tallinn' })
    return { household: view, itemId: item.id }
  }
  return {
    alder: await household('Alder', 'zentrafloss'),
    birch: await household('Birch', 'plinkvortex'),
  }
}

function call(household: ReturnType<typeof mcpHousehold>, id: string) {
  return removeShoppingItem.run(household, removeShoppingItem.inputSchema.parse({ id }), CALLER)
}

async function listedNames(household: ReturnType<typeof mcpHousehold>) {
  const list = await getShoppingList.run(household, getShoppingList.inputSchema.parse({}), CALLER)
  return list.customItems.map((item) => item.name)
}

describe('remove_shopping_item', () => {
  it('deletes a hand-added item, names it, and get_shopping_list no longer lists it', async () => {
    const { alder } = await world()
    expect(await listedNames(alder.household)).toEqual(['zentrafloss'])

    const result = await call(alder.household, alder.itemId)

    expect(result).toEqual({ outcome: 'removed', id: alder.itemId, name: 'zentrafloss' })
    expect(await listedNames(alder.household)).toEqual([])
  })

  it("refuses another household's item, and that item stays", async () => {
    const { alder, birch } = await world()

    const attempt = call(alder.household, birch.itemId)

    await expect(attempt).rejects.toThrow(ToolInputError)
    await expect(attempt).rejects.toThrow(NOT_FOUND)
    expect(await listedNames(birch.household)).toEqual(['plinkvortex'])
  })

  it('refuses an unknown id, and nothing is removed', async () => {
    const { alder } = await world()

    await expect(call(alder.household, 'item-gone')).rejects.toThrow(NOT_FOUND)
    expect(await prisma.customShoppingItem.count()).toBe(2)
  })

  it('removes the item a free-text extra put on the list, and the extra stays on its day', async () => {
    const { alder } = await world()
    const created = await createDayExtra(alder.household, { date: SATURDAY, label: 'quibblechips' })
    if (created.status !== 'created') throw new Error('extra not created')
    const extraId = created.extra.id
    const linked = await prisma.dayExtra.findUniqueOrThrow({ where: { id: extraId } })
    if (linked.customShoppingItemId === null) throw new Error('extra has no shopping item')

    const result = await call(alder.household, linked.customShoppingItemId)

    expect(result).toEqual({
      outcome: 'removed',
      id: linked.customShoppingItemId,
      name: 'quibblechips',
    })
    expect(await listedNames(alder.household)).toEqual(['zentrafloss'])
    const extra = await prisma.dayExtra.findUnique({ where: { id: extraId } })
    expect(extra).toMatchObject({ label: 'quibblechips', customShoppingItemId: null })
    expect(extra?.date.toISOString().slice(0, 10)).toBe(SATURDAY)
  })

  it('answers a read-only token with the reconnect message, and the item stays', async () => {
    const { alder } = await world()

    const result = await runTool(
      removeShoppingItem,
      { userId: 'user-1', household: alder.household, scopes: READ_SCOPES },
      { id: alder.itemId },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
    })
    expect(await listedNames(alder.household)).toEqual(['zentrafloss'])
  })
})
