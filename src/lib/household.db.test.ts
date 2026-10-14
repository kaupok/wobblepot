import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  countAccountHoldingMembers,
  getHouseholdMembership,
  hasHouseholdMembership,
  updateHousehold,
} from '@/lib/household'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks:
// the rows are written with Prisma and read back through the lib functions.

async function user(id: string) {
  return prisma.user.create({ data: { id, name: id, email: `${id}@example.com` } })
}

/** Two households: Alder has an owner, a second account and a manual member; Birch has one owner. */
async function twoHouseholds() {
  await user('u-alder-owner')
  await user('u-alder-member')
  await user('u-birch-owner')
  const alder = await prisma.household.create({
    data: {
      name: 'Alder',
      members: {
        create: [
          { userId: 'u-alder-owner', role: 'owner' },
          { userId: 'u-alder-member', role: 'member' },
          { name: 'Kid', role: 'member' },
        ],
      },
    },
  })
  const birch = await prisma.household.create({
    data: {
      name: 'Birch',
      members: { create: [{ userId: 'u-birch-owner', role: 'owner' }] },
    },
  })
  return { alder, birch }
}

describe('household persistence', () => {
  it("reads back the user's own household, with its member count", async () => {
    const { birch } = await twoHouseholds()

    const membership = await getHouseholdMembership('u-birch-owner')

    expect(membership).toMatchObject({
      userId: 'u-birch-owner',
      role: 'owner',
      householdId: birch.id,
      household: { name: 'Birch', _count: { members: 1 } },
    })
  })

  it('counts every member of a household, manual ones included', async () => {
    await twoHouseholds()

    const membership = await getHouseholdMembership('u-alder-member')

    expect(membership?.household.name).toBe('Alder')
    expect(membership?.household._count.members).toBe(3)
  })

  it('counts only the members with an account', async () => {
    const { alder, birch } = await twoHouseholds()

    expect(await countAccountHoldingMembers(alder.id)).toBe(2)
    expect(await countAccountHoldingMembers(birch.id)).toBe(1)
  })

  it('finds no membership for a user without one', async () => {
    await twoHouseholds()
    await user('u-loner')

    expect(await getHouseholdMembership('u-loner')).toBeNull()
    expect(await hasHouseholdMembership('u-loner')).toBe(false)
    expect(await hasHouseholdMembership('u-alder-owner')).toBe(true)
  })
})

// The two tests run in order: the first leaves a household behind and removes a
// global ingredient that a migration seeded (20260331140000), and the second
// sees the state the reset in `src/test/db-setup.ts` restored.
/**
 * Gives each household a plan with one dinner entry carrying cached prep tips,
 * and returns a reader for every entry's tips, keyed by entry id.
 */
async function tipsInEachPlan(households: { id: string }[]) {
  for (const { id } of households) {
    await prisma.mealPlan.create({
      data: {
        id: `plan-${id}`,
        householdId: id,
        entries: {
          create: {
            id: `entry-${id}`,
            date: new Date('2026-10-14T00:00:00Z'),
            mealType: 'dinner',
            preparationTips: '["Chop the onions"]',
          },
        },
      },
    })
  }
  return async () => {
    const entries = await prisma.mealPlanEntry.findMany({
      select: { id: true, preparationTips: true },
    })
    return Object.fromEntries(entries.map((e) => [e.id, e.preparationTips]))
  }
}

describe('updateHousehold', () => {
  it('saves the name, timezone and locale, and returns the household with its preferences', async () => {
    const { alder } = await twoHouseholds()
    await prisma.householdPreferences.create({
      data: { householdId: alder.id, allergensToAvoid: ['nuts'] },
    })

    const updated = await updateHousehold(alder, {
      name: 'Alder Grove',
      timezone: 'America/New_York',
      locale: 'et',
    })

    expect(updated).toMatchObject({
      id: alder.id,
      name: 'Alder Grove',
      timezone: 'America/New_York',
      locale: 'et',
      preferences: { allergensToAvoid: ['nuts'] },
    })
    expect(await prisma.household.findUnique({ where: { id: alder.id } })).toMatchObject({
      name: 'Alder Grove',
      timezone: 'America/New_York',
      locale: 'et',
    })
  })

  it('leaves the fields the patch does not name alone', async () => {
    const { alder } = await twoHouseholds()

    await updateHousehold(alder, { name: 'Alder Grove' })

    expect(await prisma.household.findUnique({ where: { id: alder.id } })).toMatchObject({
      name: 'Alder Grove',
      timezone: alder.timezone,
      locale: 'en',
    })
  })

  it("clears the cached prep tips in the household's own plan when the locale changes", async () => {
    const { alder, birch } = await twoHouseholds()
    const tips = await tipsInEachPlan([alder, birch])

    await updateHousehold(alder, { locale: 'et' })

    expect(await tips()).toEqual({
      [`entry-${alder.id}`]: null,
      [`entry-${birch.id}`]: '["Chop the onions"]',
    })
  })

  it.each([
    ['resends the stored locale', { locale: 'en' as const }],
    ['changes only the name', { name: 'Alder Grove' }],
    ['changes only the timezone', { timezone: 'America/New_York' }],
  ])('keeps the cached prep tips when the update %s', async (_label, patch) => {
    const { alder } = await twoHouseholds()
    const tips = await tipsInEachPlan([alder])

    await updateHousehold(alder, patch)

    expect(await tips()).toEqual({ [`entry-${alder.id}`]: '["Chop the onions"]' })
  })
})

describe('the reset between tests', () => {
  const berbere = { name: 'berbere', householdId: null }

  it('leaves rows behind', async () => {
    await twoHouseholds()
    await prisma.ingredient.deleteMany({ where: berbere })

    expect(await prisma.household.count()).toBe(2)
    expect(await prisma.ingredient.count({ where: berbere })).toBe(0)
  })

  it('empties the tables and restores the rows the migrations seeded', async () => {
    expect(await prisma.household.count()).toBe(0)
    expect(await prisma.user.count()).toBe(0)
    expect(await prisma.ingredient.count({ where: berbere })).toBe(1)
  })
})
