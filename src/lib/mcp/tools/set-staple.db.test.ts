import { describe, expect, it } from 'vitest'

import { runTool, ToolInputError, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { prisma } from '@/lib/prisma'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'

import { getPantry } from './get-pantry'
import { setPantryStatus } from './set-pantry-status'
import { setStaple } from './set-staple'

// Runs against PGlite with pg_trgm through the `unit-db` project, with no
// mocks: the real matcher finds the ingredient, `pantry-items.ts` writes it,
// and the pantry is read back through get_pantry and the rows (HON-1459).
//
// The migrations seed a shared catalogue, so the ingredient names here are
// invented words that match no seeded ingredient.

const CALLER = { userId: 'user-1' }

/**
 * Alder (English) holds 300 g of hush oats, not a staple. Glimmer rice and
 * hush oats are global; glimmer rice is "glimmeri riis" in Estonian. Brindleberry
 * jam and quorvex paste are Alder's own, so "quorvax pasta" has no match and
 * "brindleberry jelly" an unsure one. Plinkvortex sauce is Birch's own.
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
  await ingredient('ing-jam', 'brindleberry jam', { householdId: alder.id })
  await ingredient('ing-paste', 'quorvex paste', { householdId: alder.id })
  await ingredient('ing-sauce', 'plinkvortex sauce', { householdId: birch.id })
  await prisma.pantryItem.create({
    data: { householdId: alder.id, ingredientId: 'ing-oats', quantity: 300, isStaple: false },
  })
  return { alder, birch }
}

type Household = Awaited<ReturnType<typeof world>>['alder']

function call(household: Household, input: Record<string, unknown>) {
  return setStaple.run(household, setStaple.inputSchema.parse(input), CALLER)
}

async function row(household: Household, ingredientId: string) {
  return prisma.pantryItem.findUnique({
    where: { householdId_ingredientId: { householdId: household.id, ingredientId } },
  })
}

describe('set_staple', () => {
  it('puts a surely matched ingredient in the pantry as a staple with no amount', async () => {
    const { alder } = await world()

    const result = await call(alder, { name: 'glimmer rice', staple: true })

    const item = {
      ingredientId: 'ing-rice',
      name: 'glimmer rice',
      quantity: null,
      unit: 'g',
      isStaple: true,
    }
    expect(result).toEqual({ outcome: 'created', item, candidates: [] })
    const pantry = await getPantry.run(alder, {}, CALLER)
    expect(pantry.items.find((i) => i.ingredientId === 'ing-rice')).toEqual({
      ...item,
      low: false,
      neededSoon: false,
    })
  })

  it('matches an Estonian name and reports the Estonian name', async () => {
    const { birch } = await world()

    const result = await call(birch, { name: 'glimmeri riis', staple: true })

    expect(result.outcome).toBe('created')
    expect(result.item).toMatchObject({ ingredientId: 'ing-rice', name: 'glimmeri riis' })
    expect((await row(birch, 'ing-rice'))?.isStaple).toBe(true)
  })

  it('stars an item with an amount and keeps the amount', async () => {
    const { alder } = await world()

    const result = await call(alder, { name: 'hush oats', staple: true })

    expect(result).toEqual({
      outcome: 'updated',
      item: {
        ingredientId: 'ing-oats',
        name: 'hush oats',
        quantity: 300,
        unit: 'g',
        isStaple: true,
      },
      candidates: [],
    })
    expect(await row(alder, 'ing-oats')).toMatchObject({ quantity: 300, isStaple: true })
  })

  it('unstars a staple and keeps the item and its amount', async () => {
    const { alder } = await world()
    await prisma.pantryItem.update({
      where: { householdId_ingredientId: { householdId: alder.id, ingredientId: 'ing-oats' } },
      data: { isStaple: true },
    })

    const result = await call(alder, { name: 'hush oats', staple: false })

    expect(result.outcome).toBe('updated')
    expect(result.item).toMatchObject({ quantity: 300, isStaple: false })
    expect(await row(alder, 'ing-oats')).toMatchObject({ quantity: 300, isStaple: false })
  })

  it('takes the ingredientId over the name', async () => {
    const { alder } = await world()

    const result = await call(alder, {
      name: 'glimmer rice',
      ingredientId: 'ing-oats',
      staple: true,
    })

    expect(result.item).toMatchObject({ ingredientId: 'ing-oats', isStaple: true })
    expect(await row(alder, 'ing-rice')).toBeNull()
  })

  it.each([
    ['no match', 'quorvax pasta', 'ing-paste', 'quorvex paste'],
    ['an unsure match', 'brindleberry jelly', 'ing-jam', 'brindleberry jam'],
  ])(
    'writes nothing for %s and returns the closest ingredients',
    async (_label, name, ingredientId, candidate) => {
      const { alder } = await world()

      const result = await call(alder, { name, staple: true })

      expect(result).toEqual({
        outcome: 'unmatched',
        item: null,
        candidates: [{ ingredientId, name: candidate }],
      })
      expect(await prisma.pantryItem.count({ where: { householdId: alder.id } })).toBe(1)
    },
  )

  it.each([true, false])(
    "refuses another household's ingredientId as unknown (staple: %s)",
    async (staple) => {
      const { alder } = await world()

      await expect(
        call(alder, { name: 'plinkvortex sauce', ingredientId: 'ing-sauce', staple }),
      ).rejects.toThrow(
        new ToolInputError(
          'Wobblepot has no ingredient with this id. Use an ingredientId from get_pantry or get_shopping_list, or leave it out to match the name. Nothing was changed.',
        ),
      )
      expect(await prisma.pantryItem.count({ where: { householdId: alder.id } })).toBe(1)
    },
  )

  it('returns unchanged and writes nothing when a staple is starred again', async () => {
    const { alder } = await world()
    await call(alder, { name: 'hush oats', staple: true })
    const before = await row(alder, 'ing-oats')

    const result = await call(alder, { name: 'hush oats', staple: true })

    expect(result).toEqual({
      outcome: 'unchanged',
      item: {
        ingredientId: 'ing-oats',
        name: 'hush oats',
        quantity: 300,
        unit: 'g',
        isStaple: true,
      },
      candidates: [],
    })
    expect((await row(alder, 'ing-oats'))?.updatedAt).toEqual(before?.updatedAt)
  })

  it('returns unchanged and adds nothing when unstarring an ingredient not in the pantry', async () => {
    const { alder } = await world()

    const result = await call(alder, { name: 'glimmer rice', staple: false })

    expect(result).toEqual({
      outcome: 'unchanged',
      item: {
        ingredientId: 'ing-rice',
        name: 'glimmer rice',
        quantity: null,
        unit: 'g',
        isStaple: false,
      },
      candidates: [],
    })
    expect(await row(alder, 'ing-rice')).toBeNull()
  })

  it('refuses a read-only token and writes nothing', async () => {
    const { alder } = await world()

    const result = await runTool(
      setStaple,
      { userId: 'user-1', household: alder, scopes: READ_SCOPES },
      { name: 'glimmer rice', staple: true },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
    })
    expect(await row(alder, 'ing-rice')).toBeNull()
  })

  it('is named in set_pantry_status as the way to change the staple flag', () => {
    expect(setPantryStatus.description).toContain('to star or unstar a staple, use set_staple')
  })
})
