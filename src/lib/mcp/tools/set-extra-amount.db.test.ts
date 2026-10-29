import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDayExtra } from '@/lib/day-extras/day-extras'
import { runTool, ToolInputError, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { prisma } from '@/lib/prisma'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'

import { addExtra } from './add-extra'
import { getMealPlan } from './get-meal-plan'
import { setExtraAmount } from './set-extra-amount'

// Runs against PGlite through the `unit-db` project, with no mocks: the
// extras are saved with `createDayExtra`, and the rows, the day and the
// shopping list are read back (HON-1334).

// Thursday 15 October 2026, noon in Tallinn: Saturday is 17 October.
const NOW = new Date('2026-10-15T09:00:00Z')
const SATURDAY = '2026-10-17'
const CALLER = { userId: 'user-1' }
const NOT_FOUND = 'No extra with this id. Use get_meal_plan to find it. Nothing was changed.'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

type Household = ReturnType<typeof mcpHousehold>

async function saved(household: Household, input: Parameters<typeof createDayExtra>[1]) {
  const created = await createDayExtra(household, input)
  if (created.status !== 'created') throw new Error('extra not created')
  return created.extra.id
}

/**
 * Alder and Birch, in Tallinn. Red wine is measured by volume. Alder has
 * 750 ml of red wine and free-text chips on Saturday; Birch has its own wine.
 */
async function world() {
  await prisma.ingredient.create({
    data: {
      id: 'ing-wine',
      name: 'Red wine',
      category: 'condiment',
      defaultUnit: 'g',
      measuredByVolume: true,
      calories: 100,
      protein: 0,
      carbs: 0,
      fat: 0,
    },
  })
  const household = async (name: string) => {
    const row = await prisma.household.create({
      data: { name, locale: 'en', timezone: 'Europe/Tallinn', members: { create: [{ name }] } },
    })
    return mcpHousehold({ id: row.id, locale: 'en', timezone: 'Europe/Tallinn' })
  }
  const alder = await household('Alder')
  const birch = await household('Birch')
  return {
    alder,
    wineId: await saved(alder, { date: SATURDAY, ingredientId: 'ing-wine', quantity: 750 }),
    chipsId: await saved(alder, { date: SATURDAY, label: 'chips' }),
    birchWineId: await saved(birch, { date: SATURDAY, ingredientId: 'ing-wine', quantity: 750 }),
  }
}

function call(household: Household, input: Record<string, unknown>) {
  return setExtraAmount.run(household, setExtraAmount.inputSchema.parse(input), CALLER)
}

async function storedQuantity(id: string) {
  const row = await prisma.dayExtra.findUnique({ where: { id }, select: { quantity: true } })
  return row?.quantity
}

describe('set_extra_amount', () => {
  it('sets a new amount that the day shows and the shopping list buys', async () => {
    const { alder, wineId } = await world()

    const result = await call(alder, { extraId: wineId, quantity: 1500, unit: 'ml' })

    const extra = {
      id: wineId,
      date: SATURDAY,
      name: 'Red wine',
      kind: 'ingredient',
      quantity: 1500,
      unit: 'ml',
    }
    expect(result).toEqual(extra)
    expect(await storedQuantity(wineId)).toBe(1500)
    const plan = await getMealPlan.run(alder, { from: SATURDAY, to: SATURDAY }, CALLER)
    expect(plan.extras.find((e) => e.id === wineId)).toEqual(extra)
    const items = (await loadShoppingList(alder, { days: 7 })).groups.flatMap((g) => g.items)
    expect(items).toContainEqual(
      expect.objectContaining({ ingredientId: 'ing-wine', displayQuantity: '1.5l' }),
    )
  })

  it('gives an amount to an ingredient extra that has none, after a wrong guess names the unit', async () => {
    const { alder } = await world()
    const noAmountId = await saved(alder, { date: SATURDAY, ingredientId: 'ing-wine' })
    const before = await getMealPlan.run(alder, { from: SATURDAY, to: SATURDAY }, CALLER)
    expect(before.extras.find((e) => e.id === noAmountId)).toEqual(
      expect.objectContaining({ quantity: null, unit: null }),
    )

    await expect(call(alder, { extraId: noAmountId, quantity: 2, unit: 'piece' })).rejects.toThrow(
      'This extra is measured in ml.',
    )
    expect(await storedQuantity(noAmountId)).toBeNull()

    const result = await call(alder, { extraId: noAmountId, quantity: 1500, unit: 'ml' })
    expect(result).toEqual(expect.objectContaining({ id: noAmountId, quantity: 1500, unit: 'ml' }))
    expect(await storedQuantity(noAmountId)).toBe(1500)
  })

  it('clears the amount with quantity null', async () => {
    const { alder, wineId } = await world()

    const result = await call(alder, { extraId: wineId, quantity: null })

    expect(result).toEqual(expect.objectContaining({ id: wineId, quantity: null, unit: null }))
    expect(await storedQuantity(wineId)).toBeNull()
    const plan = await getMealPlan.run(alder, { from: SATURDAY, to: SATURDAY }, CALLER)
    expect(plan.extras.find((e) => e.id === wineId)).toEqual(
      expect.objectContaining({ quantity: null, unit: null }),
    )
  })

  it('refuses a unit other than the one the extra shows, and names that unit', async () => {
    const { alder, wineId } = await world()

    const attempt = call(alder, { extraId: wineId, quantity: 1500, unit: 'g' })

    await expect(attempt).rejects.toThrow(ToolInputError)
    await expect(attempt).rejects.toThrow(
      'This extra is measured in ml. Send the amount in ml. Nothing was changed.',
    )
    expect(await storedQuantity(wineId)).toBe(750)
  })

  it('refuses a free-text extra, and nothing changes', async () => {
    const { alder, chipsId } = await world()

    const attempt = call(alder, { extraId: chipsId, quantity: 2, unit: 'piece' })

    await expect(attempt).rejects.toThrow(ToolInputError)
    await expect(attempt).rejects.toThrow('A free-text extra has no amount.')
    expect(
      await prisma.dayExtra.findUnique({
        where: { id: chipsId },
        select: { label: true, quantity: true },
      }),
    ).toEqual({ label: 'chips', quantity: null })
  })

  it("refuses an unknown id and another household's extra, and that extra stays", async () => {
    const { alder, birchWineId } = await world()

    await expect(call(alder, { extraId: 'extra-gone', quantity: 1, unit: 'ml' })).rejects.toThrow(
      NOT_FOUND,
    )
    const attempt = call(alder, { extraId: birchWineId, quantity: 1500, unit: 'ml' })
    await expect(attempt).rejects.toThrow(ToolInputError)
    await expect(attempt).rejects.toThrow(NOT_FOUND)
    expect(await storedQuantity(birchWineId)).toBe(750)
  })

  it.each([
    ['a quantity with no unit', { quantity: 1500 }],
    ['a unit with no quantity', { unit: 'ml' }],
    ['a unit with quantity null', { quantity: null, unit: 'ml' }],
  ])('fails input validation for %s', (_, amount) => {
    expect(() => setExtraAmount.inputSchema.parse({ extraId: 'extra-1', ...amount })).toThrow()
  })

  it('answers a read-only token with the reconnect message, and the amount stays', async () => {
    const { alder, wineId } = await world()

    const result = await runTool(
      setExtraAmount,
      { userId: 'user-1', household: alder, scopes: READ_SCOPES },
      { extraId: wineId, quantity: 1500, unit: 'ml' },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
    })
    expect(await storedQuantity(wineId)).toBe(750)
  })

  it('is the tool add_extra points to for a changed amount', () => {
    expect(addExtra.description).toContain("To change an extra's amount, use set_extra_amount.")
  })
})
