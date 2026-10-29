import { describe, expect, it } from 'vitest'

import { AlreadyInHouseholdError, createHousehold } from '@/lib/household-claim'
import { DEFAULT_STAPLE_NAMES } from '@/lib/meal-planning/default-staples'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks:
// rows are written through `createHousehold` and read back with Prisma. The
// claim's lock and retry are tested in `household-claim.test.ts`, and the
// route test covers only how the route maps these answers.

async function user(id: string) {
  return prisma.user.create({ data: { id, name: id, email: `${id}@example.com` } })
}

/** The global ingredients `seedDefaultStaples` marks; `prisma/seed.ts` writes them, not a migration. */
async function stapleIngredients() {
  for (const name of DEFAULT_STAPLE_NAMES) {
    await prisma.ingredient.create({
      data: {
        name,
        category: 'spice',
        defaultUnit: 'g',
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
      },
    })
  }
}

describe('createHousehold', () => {
  it('creates the household with its owner, preferences and default staples', async () => {
    await user('u-owner')
    await stapleIngredients()

    const household = await createHousehold('u-owner', { name: 'Alder', locale: 'et' })

    expect(household).toMatchObject({
      name: 'Alder',
      locale: 'et',
      preferences: {
        weekdayMealTypes: ['dinner'],
        weekendMealTypes: ['dinner'],
        allergensToAvoid: [],
      },
    })
    expect(
      await prisma.householdMember.findMany({
        where: { householdId: household.id },
        select: { userId: true, role: true },
      }),
    ).toEqual([{ userId: 'u-owner', role: 'owner' }])
    // Salt, black pepper and water start as staples (HON-769).
    const staples = await prisma.pantryItem.findMany({
      where: { householdId: household.id },
      select: { isStaple: true, quantity: true, ingredient: { select: { name: true } } },
    })
    expect(staples.map((s) => s.ingredient.name).sort()).toEqual(['black pepper', 'salt', 'water'])
    expect(staples.every((s) => s.isStaple && s.quantity === null)).toBe(true)
  })

  it('adds each additional member with the portion size of its type', async () => {
    await user('u-owner')

    const household = await createHousehold('u-owner', {
      name: 'Alder',
      locale: 'en',
      members: [
        { name: 'Partner', portionType: 'adult' },
        { name: 'Kid', portionType: 'child' },
      ],
    })

    const members = await prisma.householdMember.findMany({
      where: { householdId: household.id, userId: null },
      select: { name: true, role: true, preferences: { select: { portionMultiplier: true } } },
      orderBy: { name: 'asc' },
    })
    expect(members).toEqual([
      { name: 'Kid', role: 'member', preferences: { portionMultiplier: 0.5 } },
      { name: 'Partner', role: 'member', preferences: { portionMultiplier: 1 } },
    ])
  })

  it('stores the allergens to avoid once each (HON-1082)', async () => {
    await user('u-owner')

    const household = await createHousehold('u-owner', {
      name: 'Alder',
      locale: 'en',
      allergensToAvoid: ['nuts', 'gluten', 'nuts'],
    })

    expect(household.preferences?.allergensToAvoid).toEqual(['nuts', 'gluten'])
  })

  it('refuses a user who already has a household, and writes nothing', async () => {
    await user('u-owner')
    await createHousehold('u-owner', { name: 'Alder', locale: 'en' })

    await expect(createHousehold('u-owner', { name: 'Birch', locale: 'en' })).rejects.toThrow(
      AlreadyInHouseholdError,
    )
    expect(await prisma.household.findMany({ select: { name: true } })).toEqual([{ name: 'Alder' }])
  })
})
