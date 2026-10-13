import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  countAccountHoldingMembers,
  getHouseholdMembership,
  hasHouseholdMembership,
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
