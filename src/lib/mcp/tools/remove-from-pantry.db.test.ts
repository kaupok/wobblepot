import { describe, expect, it } from 'vitest'

import { ToolInputError } from '@/lib/mcp/context'
import { prisma } from '@/lib/prisma'
import { mcpHousehold } from '@/test/mcp'

import { getPantry } from './get-pantry'
import { removeFromPantry } from './remove-from-pantry'

// Runs against PGlite through the `unit-db` project, with no mocks (HON-1497).
// The ingredient names are invented words that match no seeded ingredient.

const CALLER = { userId: 'user-1' }

/**
 * Alder holds 300 g of hush oats and snorvelgrain as a staple; glimmer rice is
 * not in its pantry. Plinkvortex sauce is Birch's own.
 */
async function world() {
  const household = async (name: string) => {
    const row = await prisma.household.create({
      data: { name, locale: 'en', timezone: 'Europe/Tallinn' },
    })
    return mcpHousehold({ id: row.id, locale: 'en', timezone: 'Europe/Tallinn' })
  }
  const alder = await household('Alder')
  const birch = await household('Birch')
  const ingredient = (id: string, name: string, householdId: string | null = null) =>
    prisma.ingredient.create({
      data: {
        id,
        name,
        householdId,
        category: 'carb',
        defaultUnit: 'g',
        calories: 100,
        protein: 0,
        carbs: 0,
        fat: 0,
      },
    })
  await ingredient('ing-oats', 'hush oats')
  await ingredient('ing-grain', 'snorvelgrain')
  await ingredient('ing-rice', 'glimmer rice')
  await ingredient('ing-sauce', 'plinkvortex sauce', birch.id)
  await prisma.pantryItem.createMany({
    data: [
      { householdId: alder.id, ingredientId: 'ing-oats', quantity: 300, isStaple: false },
      { householdId: alder.id, ingredientId: 'ing-grain', quantity: null, isStaple: true },
    ],
  })
  return { alder }
}

type Household = Awaited<ReturnType<typeof world>>['alder']

function call(household: Household, ingredientId: string) {
  return removeFromPantry.run(household, { ingredientId }, CALLER)
}

/** The ingredientIds in the pantry, as an assistant sees them through get_pantry. */
async function pantryIds(household: Household) {
  const { items } = await getPantry.run(household, {}, CALLER)
  return items.map((i) => i.ingredientId).sort()
}

describe('remove_from_pantry', () => {
  it('removes the item and returns it as it was', async () => {
    const { alder } = await world()

    const result = await call(alder, 'ing-oats')

    expect(result).toEqual({
      outcome: 'removed',
      item: {
        ingredientId: 'ing-oats',
        name: 'hush oats',
        quantity: 300,
        unit: 'g',
        isStaple: false,
      },
    })
    expect(await pantryIds(alder)).toEqual(['ing-grain'])
  })

  it('removes a staple and says it was one', async () => {
    const { alder } = await world()

    const result = await call(alder, 'ing-grain')

    expect(result.item).toMatchObject({ quantity: null, isStaple: true })
    expect(await pantryIds(alder)).toEqual(['ing-oats'])
  })

  it('changes nothing for an ingredient not in the pantry', async () => {
    const { alder } = await world()

    expect(await call(alder, 'ing-rice')).toEqual({ outcome: 'not_in_pantry', item: null })
    expect(await pantryIds(alder)).toEqual(['ing-grain', 'ing-oats'])
  })

  it("refuses another household's ingredientId as unknown", async () => {
    const { alder } = await world()

    await expect(call(alder, 'ing-sauce')).rejects.toThrow(
      new ToolInputError(
        'Wobblepot has no ingredient with this id. Use an ingredientId from get_pantry. Nothing was changed.',
      ),
    )
  })
})
