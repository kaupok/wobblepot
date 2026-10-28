import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  purchaseIngredients,
  purchasePlanIngredients,
  unpurchaseIngredient,
  unpurchasePlanIngredient,
} from '@/lib/shopping/purchase'
import { daysAgo, DAY_MS, pantryRow, refusalOf, world } from './purchase.fixtures'

// Runs against PGlite through the `unit-db` project, with no mocks: rows are
// written with Prisma, changed through `./purchase`, and read back with Prisma
// (HON-1208). The route tests cover only how the routes map these answers.

describe('purchaseIngredients', () => {
  it('puts a new ingredient in the pantry as "have some", not a staple', async () => {
    const { alder } = await world()

    const outcome = await purchaseIngredients(alder, ['ing-rice'])

    const row = await prisma.pantryItem.findUniqueOrThrow({
      where: { householdId_ingredientId: { householdId: alder.id, ingredientId: 'ing-rice' } },
    })
    expect(row.quantity).toBeNull()
    expect(row.isStaple).toBe(false)
    expect(outcome).toEqual({
      status: 'purchased',
      results: [
        {
          ingredientId: 'ing-rice',
          replacedQuantity: null,
          pantryItem: {
            id: row.id,
            ingredient: {
              id: 'ing-rice',
              name: 'rice',
              category: 'carb',
              defaultUnit: 'g',
              displayUnit: 'g',
            },
            quantity: null,
            isStaple: false,
            updatedAt: row.updatedAt.toISOString(),
          },
        },
      ],
    })
  })

  it('replaces a quantity the household entered with "have some" and reports it', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { id: 'pantry-rice', householdId: alder.id, ingredientId: 'ing-rice', quantity: 300 },
    })

    const outcome = await purchaseIngredients(alder, ['ing-rice'])

    expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity: null, isStaple: false })
    expect(outcome.status).toBe('purchased')
    if (outcome.status !== 'purchased') return
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0]).toMatchObject({
      ingredientId: 'ing-rice',
      replacedQuantity: 300,
      pantryItem: { id: 'pantry-rice', quantity: null },
    })
  })

  it('replaces a "ran out" 0 with "have some" and reports no replaced quantity', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-rice', quantity: 0 },
    })

    const outcome = await purchaseIngredients(alder, ['ing-rice'])

    expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity: null, isStaple: false })
    expect(outcome.status === 'purchased' && outcome.results[0]!.replacedQuantity).toBeNull()
  })

  it('keeps a staple a staple', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-rice', isStaple: true },
    })

    await purchaseIngredients(alder, ['ing-rice'])

    expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity: null, isStaple: true })
  })

  it('returns results in the caller order, a repeated id at both positions, with one row each', async () => {
    const { alder } = await world()

    // Reverse-sorted, so the lock order (sorted) and the caller order differ.
    const outcome = await purchaseIngredients(alder, ['ing-rice', 'ing-milk', 'ing-rice'])

    expect(outcome.status).toBe('purchased')
    if (outcome.status !== 'purchased') return
    expect(outcome.results.map((r) => [r.ingredientId, r.pantryItem.ingredient.name])).toEqual([
      ['ing-rice', 'rice'],
      ['ing-milk', 'milk'],
      ['ing-rice', 'rice'],
    ])
    expect(outcome.results[0]!.pantryItem.id).toBe(outcome.results[2]!.pantryItem.id)
    const rows = await prisma.pantryItem.findMany({
      where: { householdId: alder.id },
      select: { ingredientId: true },
      orderBy: { ingredientId: 'asc' },
    })
    expect(rows).toEqual([{ ingredientId: 'ing-milk' }, { ingredientId: 'ing-rice' }])
  })

  it("answers invalid_ids for another household's ingredient and an unknown id, and writes nothing", async () => {
    const { alder } = await world()

    const outcome = await purchaseIngredients(alder, [
      'ing-rice',
      'ing-birch-chutney',
      'ing-unknown',
    ])

    expect(outcome).toEqual({
      status: 'invalid_ids',
      invalidIds: ['ing-birch-chutney', 'ing-unknown'],
    })
    expect(await prisma.pantryItem.count()).toBe(0)
  })

  it("puts the household's own ingredient in its pantry", async () => {
    const { alder } = await world()

    const outcome = await purchaseIngredients(alder, ['ing-alder-stock'])

    expect(outcome.status).toBe('purchased')
    expect(await pantryRow(alder.id, 'ing-alder-stock')).toEqual({
      quantity: null,
      isStaple: false,
    })
  })

  it('names the ingredient in Estonian for an et household (HON-913)', async () => {
    await world()
    const kask = await prisma.household.create({ data: { name: 'Kask', locale: 'et' } })

    const outcome = await purchaseIngredients(kask, ['ing-rice'])

    expect(outcome.status === 'purchased' && outcome.results[0]!.pantryItem.ingredient).toEqual({
      id: 'ing-rice',
      name: 'riis',
      category: 'carb',
      defaultUnit: 'g',
      displayUnit: 'g',
    })
  })

  it('gives a volume ingredient its millilitres, so its pantry row shows ml (HON-1402)', async () => {
    const { alder } = await world()
    await prisma.ingredient.update({ where: { id: 'ing-milk' }, data: { measuredByVolume: true } })

    const outcome = await purchaseIngredients(alder, ['ing-milk'])

    expect(
      outcome.status === 'purchased' && outcome.results[0]!.pantryItem.ingredient.displayUnit,
    ).toBe('ml')
  })

  it('leaves the same ingredient in another household alone', async () => {
    const { alder, birch } = await world()
    await prisma.pantryItem.create({
      data: { householdId: birch.id, ingredientId: 'ing-rice', quantity: 300 },
    })

    await purchaseIngredients(alder, ['ing-rice'])

    expect(await pantryRow(birch.id, 'ing-rice')).toEqual({ quantity: 300, isStaple: false })
  })
})

describe('unpurchaseIngredient', () => {
  it('removes a recently purchased ingredient from the pantry', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-rice', updatedAt: daysAgo(1) },
    })

    expect(await unpurchaseIngredient(alder.id, 'ing-rice')).toBe('removed')
    expect(await pantryRow(alder.id, 'ing-rice')).toBeNull()
  })

  it('removes a row just inside the 7-day window', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: {
        householdId: alder.id,
        ingredientId: 'ing-rice',
        updatedAt: new Date(Date.now() - 7 * DAY_MS + 60_000),
      },
    })

    expect(await unpurchaseIngredient(alder.id, 'ing-rice')).toBe('removed')
    expect(await pantryRow(alder.id, 'ing-rice')).toBeNull()
  })

  it('answers not_in_pantry when the household has no row for it', async () => {
    const { alder } = await world()

    expect(await unpurchaseIngredient(alder.id, 'ing-rice')).toBe('not_in_pantry')
  })

  it('sets a recently bought staple back to ran out and keeps it a staple', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-rice', quantity: 0, isStaple: true },
    })
    await purchaseIngredients(alder, ['ing-rice'])
    expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity: null, isStaple: true })

    expect(await unpurchaseIngredient(alder.id, 'ing-rice')).toBe('ran_out')
    expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity: 0, isStaple: true })
  })

  it('keeps a staple bought more than 7 days ago as it is', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: {
        householdId: alder.id,
        ingredientId: 'ing-rice',
        isStaple: true,
        updatedAt: daysAgo(8),
      },
    })

    expect(await unpurchaseIngredient(alder.id, 'ing-rice')).toBe('too_old')
    expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity: null, isStaple: true })
  })

  it('keeps a row older than 7 days', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-rice', updatedAt: daysAgo(8) },
    })

    expect(await unpurchaseIngredient(alder.id, 'ing-rice')).toBe('too_old')
    expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity: null, isStaple: false })
  })

  it('keeps a row with a quantity above 0 when asked to', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-rice', quantity: 300 },
    })

    expect(await unpurchaseIngredient(alder.id, 'ing-rice', { keepWithQuantity: true })).toBe(
      'has_quantity',
    )
    expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity: 300, isStaple: false })
  })

  it('removes a row with a quantity above 0 without keepWithQuantity', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-rice', quantity: 300 },
    })

    expect(await unpurchaseIngredient(alder.id, 'ing-rice')).toBe('removed')
    expect(await pantryRow(alder.id, 'ing-rice')).toBeNull()
  })

  it('removes a "ran out" 0 even with keepWithQuantity', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-rice', quantity: 0 },
    })

    expect(await unpurchaseIngredient(alder.id, 'ing-rice', { keepWithQuantity: true })).toBe(
      'removed',
    )
    expect(await pantryRow(alder.id, 'ing-rice')).toBeNull()
  })

  it("never touches another household's row for the same ingredient", async () => {
    const { alder, birch } = await world()
    await prisma.pantryItem.create({
      data: { householdId: birch.id, ingredientId: 'ing-rice' },
    })

    expect(await unpurchaseIngredient(alder.id, 'ing-rice')).toBe('not_in_pantry')
    expect(await pantryRow(birch.id, 'ing-rice')).toEqual({ quantity: null, isStaple: false })
  })
})

describe('purchasePlanIngredients', () => {
  it("puts the ingredients in the pantry for the household's plan", async () => {
    const { alder } = await world()

    const outcome = await purchasePlanIngredients(alder, 'plan-alder', ['ing-rice'])

    expect(outcome.status).toBe('purchased')
    expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity: null, isStaple: false })
  })

  it('refuses a plan that does not exist and writes nothing', async () => {
    const { alder } = await world()

    expect(await refusalOf(purchasePlanIngredients(alder, 'plan-missing', ['ing-rice']))).toBe(
      'planNotFound',
    )
    expect(await prisma.pantryItem.count()).toBe(0)
  })

  it("refuses another household's plan and writes nothing", async () => {
    const { alder } = await world()

    expect(await refusalOf(purchasePlanIngredients(alder, 'plan-birch', ['ing-rice']))).toBe(
      'otherHousehold',
    )
    expect(await prisma.pantryItem.count()).toBe(0)
  })
})

describe('unpurchasePlanIngredient', () => {
  it("takes the ingredient out of the pantry for the household's plan", async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-rice', quantity: 300 },
    })

    expect(await unpurchasePlanIngredient(alder.id, 'plan-alder', 'ing-rice')).toBe('removed')
    expect(await pantryRow(alder.id, 'ing-rice')).toBeNull()
  })

  it('answers the same outcomes as unpurchaseIngredient', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-rice', isStaple: true },
    })

    expect(await unpurchasePlanIngredient(alder.id, 'plan-alder', 'ing-rice')).toBe('ran_out')
    expect(await unpurchasePlanIngredient(alder.id, 'plan-alder', 'ing-milk')).toBe('not_in_pantry')
  })

  it('passes restoreQuantity through', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-rice' },
    })

    expect(
      await unpurchasePlanIngredient(alder.id, 'plan-alder', 'ing-rice', { restoreQuantity: 200 }),
    ).toBe('restored')
    expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity: 200, isStaple: false })
  })

  it('refuses a plan that does not exist and deletes nothing', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-rice' },
    })

    expect(await refusalOf(unpurchasePlanIngredient(alder.id, 'plan-missing', 'ing-rice'))).toBe(
      'planNotFound',
    )
    expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity: null, isStaple: false })
  })

  it("refuses another household's plan and deletes nothing", async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-rice' },
    })

    expect(await refusalOf(unpurchasePlanIngredient(alder.id, 'plan-birch', 'ing-rice'))).toBe(
      'otherHousehold',
    )
    expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity: null, isStaple: false })
  })
})
