import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { purchaseIngredients, unpurchaseIngredient } from '@/lib/shopping/purchase'
import { daysAgo, pantryRow, world } from './purchase.fixtures'

// A purchase and its undo together, on PGlite with no mocks, as in
// `purchase.db.test.ts`.

describe('purchase then unpurchase', () => {
  it('puts the ingredient in the pantry and takes it back out', async () => {
    const { alder } = await world()

    await purchaseIngredients(alder, ['ing-rice'])
    expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity: null, isStaple: false })

    expect(await unpurchaseIngredient(alder.id, 'ing-rice')).toBe('removed')
    expect(await pantryRow(alder.id, 'ing-rice')).toBeNull()
  })

  // HON-1233: an empty upsert update left `updatedAt` alone, so the undo
  // answered too_old.
  it('renews the 7-day window of an old "have some" row, so the undo still works', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-rice', updatedAt: daysAgo(10) },
    })
    const before = Date.now()

    const outcome = await purchaseIngredients(alder, ['ing-rice'])

    expect(outcome.status).toBe('purchased')
    if (outcome.status !== 'purchased') return
    expect(Date.parse(outcome.results[0]!.pantryItem.updatedAt)).toBeGreaterThanOrEqual(before)
    expect(await unpurchaseIngredient(alder.id, 'ing-rice')).toBe('removed')
  })

  // HON-1438: the app's untick deleted the row and the 200 g the household
  // entered.
  it('puts back the quantity the purchase replaced, with restoreQuantity', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-rice', quantity: 200 },
    })

    const outcome = await purchaseIngredients(alder, ['ing-rice'])
    expect(outcome.status).toBe('purchased')
    if (outcome.status !== 'purchased') return
    expect(outcome.results[0]!.replacedQuantity).toBe(200)
    expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity: null, isStaple: false })

    expect(await unpurchaseIngredient(alder.id, 'ing-rice', { restoreQuantity: 200 })).toBe(
      'restored',
    )
    expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity: 200, isStaple: false })
  })

  it('puts back the quantity of a staple, not 0, with restoreQuantity', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-rice', quantity: 200, isStaple: true },
    })

    await purchaseIngredients(alder, ['ing-rice'])

    expect(await unpurchaseIngredient(alder.id, 'ing-rice', { restoreQuantity: 200 })).toBe(
      'restored',
    )
    expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity: 200, isStaple: true })
  })

  it('still removes the row, and sets a staple to 0, without restoreQuantity', async () => {
    const { alder } = await world()
    await prisma.pantryItem.createMany({
      data: [
        { householdId: alder.id, ingredientId: 'ing-rice', quantity: 200 },
        { householdId: alder.id, ingredientId: 'ing-milk', quantity: 200, isStaple: true },
      ],
    })

    await purchaseIngredients(alder, ['ing-rice', 'ing-milk'])

    expect(await unpurchaseIngredient(alder.id, 'ing-rice')).toBe('removed')
    expect(await pantryRow(alder.id, 'ing-rice')).toBeNull()
    expect(await unpurchaseIngredient(alder.id, 'ing-milk')).toBe('ran_out')
    expect(await pantryRow(alder.id, 'ing-milk')).toEqual({ quantity: 0, isStaple: true })
  })

  // An amount set on the row after the tick is newer than the one the tick
  // replaced, so the undo keeps it, as it keeps "ran out".
  it.each([150, 0])(
    'keeps a quantity of %s set after the purchase, with restoreQuantity',
    async (quantity) => {
      const { alder } = await world()
      await prisma.pantryItem.create({
        data: { householdId: alder.id, ingredientId: 'ing-rice', quantity: 200 },
      })
      await purchaseIngredients(alder, ['ing-rice'])
      await prisma.pantryItem.update({
        where: { householdId_ingredientId: { householdId: alder.id, ingredientId: 'ing-rice' } },
        data: { quantity },
      })

      expect(await unpurchaseIngredient(alder.id, 'ing-rice', { restoreQuantity: 200 })).toBe(
        'has_quantity',
      )
      expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity, isStaple: false })
    },
  )

  it('keeps a row older than 7 days as it is, even with restoreQuantity', async () => {
    const { alder } = await world()
    await prisma.pantryItem.create({
      data: { householdId: alder.id, ingredientId: 'ing-rice', updatedAt: daysAgo(8) },
    })

    expect(await unpurchaseIngredient(alder.id, 'ing-rice', { restoreQuantity: 200 })).toBe(
      'too_old',
    )
    expect(await pantryRow(alder.id, 'ing-rice')).toEqual({ quantity: null, isStaple: false })
  })
})
