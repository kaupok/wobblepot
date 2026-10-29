import { describe, expect, it } from 'vitest'

import { getHouseholdMembership, MAX_HOUSEHOLD_MEMBERS } from '@/lib/household'
import {
  addMember,
  getHouseholdMember,
  listMembersForAssistant,
  MemberChangeError,
  type MemberChangeRefusal,
  removeMember,
  updateMember,
} from '@/lib/household/members'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks:
// rows are written with Prisma, changed through the lib functions, and read
// back. The route tests cover only how the routes map these answers.

const DAY = 24 * 60 * 60 * 1000
const TIPS = '["Chop the onions"]'

async function user(id: string) {
  return prisma.user.create({ data: { id, name: id, email: `${id}@example.com` } })
}

/**
 * Alder: the owner account, a partner account and a manual member "Kid", all
 * at 1×. Its plan holds a future entry with cached prep tips and a future
 * entry with its own serving count. Birch, another household, has one owner
 * and a future entry with tips too.
 */
async function households() {
  await user('u-owner')
  await user('u-partner')
  await user('u-birch')
  const future = new Date(Date.now() + 7 * DAY)
  const entry = (id: string, date: Date, extra: object = {}) => ({
    id,
    date,
    mealType: 'dinner' as const,
    preparationTips: TIPS,
    ...extra,
  })
  await prisma.household.create({
    data: {
      name: 'Alder',
      members: {
        create: [
          { id: 'm-owner', userId: 'u-owner', role: 'owner' },
          { id: 'm-partner', userId: 'u-partner', role: 'member' },
          { id: 'm-kid', name: 'Kid', role: 'member' },
        ],
      },
      mealPlans: {
        create: {
          entries: {
            create: [
              entry('future', future),
              entry('override', new Date(future.getTime() + DAY), { servingOverride: 4 }),
            ],
          },
        },
      },
    },
  })
  await prisma.household.create({
    data: {
      name: 'Birch',
      members: { create: [{ id: 'm-birch', userId: 'u-birch', role: 'owner' }] },
      mealPlans: { create: { entries: { create: [entry('birch-future', future)] } } },
    },
  })
  return {
    owner: (await getHouseholdMembership('u-owner'))!,
    partner: (await getHouseholdMembership('u-partner'))!,
  }
}

async function tips() {
  const entries = await prisma.mealPlanEntry.findMany({
    select: { id: true, preparationTips: true },
  })
  return Object.fromEntries(entries.map((e) => [e.id, e.preparationTips]))
}

const UNTOUCHED = { future: TIPS, override: TIPS, 'birch-future': TIPS }

async function refusalOf(change: Promise<unknown>): Promise<MemberChangeRefusal> {
  const error = await change.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(MemberChangeError)
  return (error as MemberChangeError).reason
}

describe('getHouseholdMember', () => {
  it('returns a member of the household with their account and preferences', async () => {
    const { owner } = await households()
    await prisma.memberPreferences.create({
      data: { memberId: 'm-partner', displayName: 'Mum' },
    })

    expect(await getHouseholdMember(owner.householdId, 'm-partner')).toMatchObject({
      id: 'm-partner',
      userId: 'u-partner',
      role: 'member',
      user: { id: 'u-partner', name: 'u-partner', email: 'u-partner@example.com', image: null },
      preferences: { displayName: 'Mum', portionMultiplier: 1 },
    })
  })

  // The view leaves out the row's id, member link and timestamps.
  it('returns only the display name and portion size of the stored preferences', async () => {
    const { owner } = await households()
    await prisma.memberPreferences.create({
      data: { memberId: 'm-partner', displayName: 'Mum', portionMultiplier: 1.5 },
    })

    const member = await getHouseholdMember(owner.householdId, 'm-partner')

    expect(member?.preferences).toEqual({ displayName: 'Mum', portionMultiplier: 1.5 })
  })

  it("returns null for another household's member and for an unknown id", async () => {
    const { owner } = await households()

    expect(await getHouseholdMember(owner.householdId, 'm-birch')).toBeNull()
    expect(await getHouseholdMember(owner.householdId, 'm-nobody')).toBeNull()
  })
})

describe('listMembersForAssistant', () => {
  it("returns each member's shown name, account link and portion size, and nothing else", async () => {
    const { owner } = await households()
    await prisma.memberPreferences.createMany({
      data: [
        { memberId: 'm-partner', displayName: 'Mum', portionMultiplier: 1.5 },
        // An empty display name falls through to the account name.
        { memberId: 'm-owner', displayName: '', portionMultiplier: 1 },
        { memberId: 'm-kid', portionMultiplier: 0.5 },
      ],
    })

    expect(await listMembersForAssistant(owner.householdId)).toEqual([
      { name: 'Kid', linked: false, portionMultiplier: 0.5 },
      { name: 'u-owner', linked: true, portionMultiplier: 1 },
      { name: 'Mum', linked: true, portionMultiplier: 1.5 },
    ])
  })

  it('counts a member with no preferences row at 1x', async () => {
    const { owner } = await households()

    expect(await listMembersForAssistant(owner.householdId)).toContainEqual({
      name: 'Kid',
      linked: false,
      portionMultiplier: 1,
    })
  })
})

describe('addMember', () => {
  it('adds a manual member with preferences', async () => {
    const { owner } = await households()

    const added = await addMember(owner, {
      name: 'Grandma',
      preferences: { displayName: 'Nana', portionMultiplier: 0.75 },
    })

    expect(added).toMatchObject({
      userId: null,
      name: 'Grandma',
      role: 'member',
      user: null,
      invite: null,
    })
    expect(added.preferences).toEqual({ displayName: 'Nana', portionMultiplier: 0.75 })
    expect(
      await prisma.householdMember.findUniqueOrThrow({
        where: { id: added.id },
        include: { preferences: true },
      }),
    ).toMatchObject({
      householdId: owner.householdId,
      name: 'Grandma',
      role: 'member',
      preferences: { displayName: 'Nana', portionMultiplier: 0.75 },
    })
  })

  it('writes no preferences row when none are sent', async () => {
    const { owner } = await households()

    const added = await addMember(owner, { name: 'Grandma' })

    expect(added.preferences).toBeNull()
    expect(await prisma.memberPreferences.count({ where: { memberId: added.id } })).toBe(0)
  })

  // A larger household prices the cached tips on every entry without its own
  // serving count, so they are stale (HON-684).
  it("clears the tips on the household's future entries", async () => {
    const { owner } = await households()

    await addMember(owner, { name: 'Grandma' })

    expect(await tips()).toEqual({ ...UNTOUCHED, future: null })
  })

  // HON-720: the cap holds on every add after onboarding.
  it('refuses an add at the cap and writes nothing', async () => {
    const { owner } = await households()
    await prisma.householdMember.createMany({
      data: Array.from({ length: MAX_HOUSEHOLD_MEMBERS - 3 }, (_, i) => ({
        householdId: owner.householdId,
        name: `Guest ${i}`,
        role: 'member' as const,
      })),
    })

    expect(await refusalOf(addMember(owner, { name: 'One too many' }))).toBe('householdFull')
    expect(await prisma.householdMember.count({ where: { householdId: owner.householdId } })).toBe(
      MAX_HOUSEHOLD_MEMBERS,
    )
    expect(await tips()).toEqual(UNTOUCHED)
  })

  it('accepts an add one below the cap', async () => {
    const { owner } = await households()
    await prisma.householdMember.createMany({
      data: Array.from({ length: MAX_HOUSEHOLD_MEMBERS - 4 }, (_, i) => ({
        householdId: owner.householdId,
        name: `Guest ${i}`,
        role: 'member' as const,
      })),
    })

    await addMember(owner, { name: 'The last seat' })

    expect(await prisma.householdMember.count({ where: { householdId: owner.householdId } })).toBe(
      MAX_HOUSEHOLD_MEMBERS,
    )
  })
})

describe('updateMember', () => {
  it('renames a manual member and saves their preferences', async () => {
    const { owner } = await households()

    const updated = await updateMember(owner, 'm-kid', {
      name: 'Kiddo',
      preferences: { displayName: 'K', portionMultiplier: 1.5 },
    })

    expect(updated).toMatchObject({
      id: 'm-kid',
      name: 'Kiddo',
      user: null,
      preferences: { displayName: 'K', portionMultiplier: 1.5 },
    })
    expect(
      await prisma.householdMember.findUniqueOrThrow({
        where: { id: 'm-kid' },
        include: { preferences: true },
      }),
    ).toMatchObject({ name: 'Kiddo', preferences: { displayName: 'K', portionMultiplier: 1.5 } })
  })

  it('lets a member who is not the owner edit their own preferences', async () => {
    const { partner } = await households()

    const updated = await updateMember(partner, 'm-partner', {
      preferences: { displayName: 'Mum' },
    })

    expect(updated.preferences).toMatchObject({ displayName: 'Mum' })
  })

  it('refuses a member who is not the owner editing someone else, and writes nothing', async () => {
    const { partner } = await households()

    expect(
      await refusalOf(updateMember(partner, 'm-kid', { preferences: { displayName: 'K' } })),
    ).toBe('notAllowed')
    expect(await prisma.memberPreferences.count()).toBe(0)
  })

  it('refuses a rename of a member with an account', async () => {
    const { owner } = await households()

    expect(await refusalOf(updateMember(owner, 'm-partner', { name: 'Renamed' }))).toBe(
      'linkedName',
    )
    expect(
      (await prisma.householdMember.findUniqueOrThrow({ where: { id: 'm-partner' } })).name,
    ).toBeNull()
  })

  it("refuses another household's member and an unknown id", async () => {
    const { owner } = await households()

    expect(await refusalOf(updateMember(owner, 'm-birch', { name: 'X' }))).toBe('notFound')
    expect(await refusalOf(updateMember(owner, 'm-nobody', { name: 'X' }))).toBe('notFound')
  })

  // Servings 1 + 1 + 1 = 3 move to 3.5 (HON-1040).
  it("clears the tips on the household's future entries when its servings move", async () => {
    const { owner } = await households()

    await updateMember(owner, 'm-kid', { preferences: { portionMultiplier: 1.5 } })

    expect(await tips()).toEqual({ ...UNTOUCHED, future: null })
  })

  it('keeps the tips when the portion size is saved unchanged', async () => {
    const { owner } = await households()

    await updateMember(owner, 'm-kid', { name: 'Kiddo', preferences: { portionMultiplier: 1 } })

    expect(await tips()).toEqual(UNTOUCHED)
  })
})

describe('removeMember', () => {
  it('removes a member and their preferences', async () => {
    const { owner } = await households()
    await prisma.memberPreferences.create({ data: { memberId: 'm-kid' } })

    await removeMember(owner, 'm-kid')

    expect(await prisma.householdMember.findUnique({ where: { id: 'm-kid' } })).toBeNull()
    expect(await prisma.memberPreferences.count()).toBe(0)
  })

  // A smaller household prices the cached tips differently (HON-684).
  it("clears the tips on the household's future entries", async () => {
    const { owner } = await households()

    await removeMember(owner, 'm-partner')

    expect(await tips()).toEqual({ ...UNTOUCHED, future: null })
  })

  // Only the owner can remove, so this refusal is what keeps a household from
  // losing its last member.
  it('refuses the owner removing themselves', async () => {
    const { owner } = await households()
    await prisma.householdMember.deleteMany({ where: { id: { in: ['m-partner', 'm-kid'] } } })

    expect(await refusalOf(removeMember(owner, 'm-owner'))).toBe('self')
    expect(await prisma.householdMember.count({ where: { householdId: owner.householdId } })).toBe(
      1,
    )
  })

  it('refuses a removal of the household owner', async () => {
    const { owner } = await households()
    // A second owner row can only come from data drift; the rule still holds.
    await prisma.householdMember.update({ where: { id: 'm-partner' }, data: { role: 'owner' } })

    expect(await refusalOf(removeMember(owner, 'm-partner'))).toBe('owner')
    expect(await prisma.householdMember.findUnique({ where: { id: 'm-partner' } })).not.toBeNull()
  })

  it("refuses another household's member and an unknown id", async () => {
    const { owner } = await households()

    expect(await refusalOf(removeMember(owner, 'm-birch'))).toBe('notFound')
    expect(await refusalOf(removeMember(owner, 'm-nobody'))).toBe('notFound')
    expect(await prisma.householdMember.findUnique({ where: { id: 'm-birch' } })).not.toBeNull()
    expect(await tips()).toEqual(UNTOUCHED)
  })
})
