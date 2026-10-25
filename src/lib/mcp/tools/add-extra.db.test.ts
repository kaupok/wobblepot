import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { loadDayExtras } from '@/lib/day-extras/day-extras'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'
import { runTool, ToolInputError, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'
import { addExtra } from './add-extra'
import { getMealPlan } from './get-meal-plan'

// Runs against PGlite with pg_trgm through the `unit-db` project, with no
// mocks: the real matcher finds the ingredients, `createDayExtra` saves the
// extra, and the day and the shopping list are read back (HON-1311).

// Thursday 15 October 2026, noon in Tallinn: Saturday is 17 October.
const NOW = new Date('2026-10-15T09:00:00Z')
const TODAY = '2026-10-15'
const SATURDAY = '2026-10-17'
const CALLER = { userId: 'user-1' }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Alder, in Tallinn. Red wine is global and measured by volume. The made-up
 * names are Alder's own and never clash with the seeded pool, so "quorvax
 * pasta" has no match and "brindleberry jelly" an unsure one. A glimmer egg
 * weighs 50 g; nothing says what a piece of red wine weighs.
 */
async function world() {
  const row = await prisma.household.create({
    data: {
      name: 'Alder',
      locale: 'en',
      timezone: 'Europe/Tallinn',
      members: { create: [{ name: 'A' }] },
    },
  })
  const ingredient = (id: string, name: string, data: Record<string, unknown> = {}) =>
    prisma.ingredient.create({
      data: {
        id,
        name,
        category: 'condiment',
        defaultUnit: 'g',
        calories: 100,
        protein: 0,
        carbs: 0,
        fat: 0,
        ...data,
      },
    })
  await ingredient('ing-wine', 'Red wine', { measuredByVolume: true })
  await ingredient('ing-jam', 'brindleberry jam', { householdId: row.id })
  await ingredient('ing-paste', 'quorvex paste', { householdId: row.id })
  await ingredient('ing-egg', 'glimmer egg', {
    householdId: row.id,
    defaultUnit: 'piece',
    gramsPerPiece: 50,
  })
  return mcpHousehold({ id: row.id, locale: 'en', timezone: 'Europe/Tallinn' })
}

type Household = Awaited<ReturnType<typeof world>>

function call(household: Household, input: Record<string, unknown>) {
  return addExtra.run(household, addExtra.inputSchema.parse(input), CALLER)
}

const range = { startDate: new Date('2026-10-01'), endDate: new Date('2026-12-01') }

describe('add_extra', () => {
  it('saves a sure match as an ingredient extra that the day shows and the shopping list buys', async () => {
    const household = await world()

    const result = await call(household, {
      date: SATURDAY,
      name: 'red wine',
      quantity: 750,
      unit: 'ml',
    })

    const extra = {
      id: expect.any(String),
      date: SATURDAY,
      name: 'Red wine',
      kind: 'ingredient',
      quantity: 750,
      unit: 'ml',
    }
    expect(result).toEqual({ outcome: 'added', extra, check: null, alternatives: [] })
    expect(addExtra.outputSchema.safeParse(result).success).toBe(true)
    expect(await loadDayExtras(household, range)).toEqual([
      expect.objectContaining({ date: SATURDAY, ingredientId: 'ing-wine', quantity: 750 }),
    ])
    const items = (await loadShoppingList(household, { days: 7 })).groups.flatMap((g) => g.items)
    expect(items).toEqual([
      expect.objectContaining({
        ingredientId: 'ing-wine',
        displayQuantity: '750ml',
        neededByDate: SATURDAY,
      }),
    ])

    const plan = await getMealPlan.run(household, { from: SATURDAY, to: SATURDAY }, CALLER)
    expect(plan.extras).toEqual([extra])
  })

  it('saves an amount in the ingredient’s own unit as given, however large', async () => {
    const household = await world()

    const result = await call(household, {
      date: SATURDAY,
      name: 'red wine',
      quantity: 1500,
      unit: 'ml',
    })

    expect(result.extra).toMatchObject({ quantity: 1500, unit: 'ml' })
  })

  it('saves an amount it converts by a known weight per piece', async () => {
    const household = await world()

    const result = await call(household, {
      date: SATURDAY,
      name: 'glimmer egg',
      quantity: 100,
      unit: 'g',
    })

    expect(result.extra).toMatchObject({ kind: 'ingredient', quantity: 2, unit: 'piece' })
  })

  it.each([
    [
      'pieces of an ingredient with no weight per piece',
      { name: 'red wine', quantity: 500, unit: 'piece' },
      {
        name: 'Red wine',
        quantity: 15000,
        unit: 'ml',
        warning:
          'Wobblepot does not know what one piece of Red wine weighs, so 500 piece became 15000 ml by a guess.',
      },
    ],
    [
      'a converted amount the matcher flags',
      { name: 'glimmer egg', quantity: 50000, unit: 'g' },
      {
        name: 'glimmer egg',
        quantity: 1000,
        unit: 'piece',
        warning: '50000 g became 1000 piece, which is unusually high.',
      },
    ],
  ])('saves nothing for %s, and returns check_quantity', async (_label, input, check) => {
    const household = await world()

    const result = await call(household, { date: SATURDAY, ...input })

    expect(result).toEqual({ outcome: 'check_quantity', extra: null, check, alternatives: [] })
    expect(addExtra.outputSchema.safeParse(result).success).toBe(true)
    expect(await prisma.dayExtra.count()).toBe(0)
  })

  it('saves a sure match with no amount as an ingredient extra with none', async () => {
    const household = await world()

    const result = await call(household, { date: SATURDAY, name: 'red wine' })

    expect(result.extra).toMatchObject({ kind: 'ingredient', quantity: null, unit: null })
  })

  it('saves a name with no match and no amount as text, and puts it on the shopping list', async () => {
    const household = await world()

    const result = await call(household, { date: SATURDAY, name: 'chips' })

    expect(result).toEqual({
      outcome: 'added',
      extra: {
        id: expect.any(String),
        date: SATURDAY,
        name: 'chips',
        kind: 'text',
        quantity: null,
        unit: null,
      },
      check: null,
      alternatives: [],
    })
    const custom = await prisma.customShoppingItem.findMany({
      where: { householdId: household.id },
    })
    expect(custom.map((i) => i.name)).toEqual(['chips'])
  })

  it('saves an unsure match with no amount as text, under the name the user gave', async () => {
    const household = await world()

    const result = await call(household, { date: SATURDAY, name: 'brindleberry jelly' })

    expect(result.extra).toMatchObject({ name: 'brindleberry jelly', kind: 'text' })
  })

  it.each([
    ['no match', 'quorvax pasta', 'quorvex paste'],
    ['an unsure match', 'brindleberry jelly', 'brindleberry jam'],
  ])(
    'saves nothing for %s with an amount, and returns the closest ingredients',
    async (_label, name, alternative) => {
      const household = await world()

      const result = await call(household, { date: SATURDAY, name, quantity: 2, unit: 'piece' })

      expect(result).toEqual({
        outcome: 'unmatched',
        extra: null,
        check: null,
        alternatives: [alternative],
      })
      expect(await prisma.dayExtra.count()).toBe(0)
      expect(await prisma.customShoppingItem.count()).toBe(0)
    },
  )

  it('accepts today and the 28th day ahead', async () => {
    const household = await world()

    await call(household, { date: TODAY, name: 'chips' })
    await call(household, { date: '2026-11-12', name: 'chips' })

    expect((await loadDayExtras(household, range)).map((e) => e.date)).toEqual([
      TODAY,
      '2026-11-12',
    ])
  })

  it.each([
    ['yesterday', '2026-10-14', '2026-10-14 is in the past'],
    ['29 days ahead', '2026-11-13', 'Add to a day from today to 2026-11-12. Nothing was changed.'],
  ])('refuses %s and saves nothing', async (_label, date, message) => {
    const household = await world()

    const attempt = call(household, { date, name: 'red wine', quantity: 750, unit: 'ml' })

    await expect(attempt).rejects.toThrow(ToolInputError)
    await expect(attempt).rejects.toThrow(message)
    expect(await prisma.dayExtra.count()).toBe(0)
  })

  it.each([
    ['a quantity without a unit', { quantity: 750 }],
    ['a unit without a quantity', { unit: 'ml' }],
    ['a unit outside g, ml and piece', { quantity: 2, unit: 'bottle' }],
    ['a name over 80 characters', { name: 'a'.repeat(81) }],
  ])('fails input validation for %s', (_label, input) => {
    const parsed = addExtra.inputSchema.safeParse({ date: SATURDAY, name: 'red wine', ...input })

    expect(parsed.success).toBe(false)
  })

  it('answers a read-only token with the reconnect message and saves nothing', async () => {
    const household = await world()

    const result = await runTool(
      addExtra,
      { userId: 'user-1', household, scopes: READ_SCOPES },
      { date: SATURDAY, name: 'chips' },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
    })
    expect(await prisma.dayExtra.count()).toBe(0)
  })
})
