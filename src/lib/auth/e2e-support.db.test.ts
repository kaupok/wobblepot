import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  assertEmailUnverified,
  E2eSupportError,
  expirePurge,
  findPendingResetToken,
  readHouseholdState,
  readUserState,
  type E2eSupportRefusal,
} from '@/lib/auth/e2e-support'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.

const NOW = new Date('2026-10-15T12:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000

async function user(id: string, data: { emailVerified?: boolean; deletedAt?: Date } = {}) {
  await prisma.user.create({ data: { id, name: id, email: `${id}@example.com`, ...data } })
}

function resetRow(id: string, userId: string, token: string, expiresAt: Date, createdAt: Date) {
  return prisma.verification.create({
    data: { id, identifier: `reset-password:${token}`, value: userId, expiresAt, createdAt },
  })
}

async function refusalOf(promise: Promise<unknown>): Promise<E2eSupportRefusal> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof E2eSupportError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.reason
}

describe('findPendingResetToken', () => {
  it("returns the user's newest unexpired token without its prefix", async () => {
    await user('ann')
    await user('bob')
    const later = new Date(NOW.getTime() + HOUR_MS)
    await resetRow('v-old', 'ann', 'tok-old', later, new Date(NOW.getTime() - 2 * HOUR_MS))
    await resetRow('v-new', 'ann', 'tok-new', later, new Date(NOW.getTime() - HOUR_MS))
    await resetRow('v-bob', 'bob', 'tok-bob', later, NOW)
    // Another kind of verification row for the same user.
    await prisma.verification.create({
      data: {
        id: 'v-other',
        identifier: 'email-otp:123',
        value: 'ann',
        expiresAt: later,
        createdAt: NOW,
      },
    })

    expect(await findPendingResetToken('ann@example.com', NOW)).toEqual({
      token: 'tok-new',
      expiresAt: later,
    })
  })

  it('refuses an address with only an expired token', async () => {
    await user('ann')
    await resetRow(
      'v-expired',
      'ann',
      'tok',
      new Date(NOW.getTime() - 1),
      new Date(NOW.getTime() - HOUR_MS),
    )

    expect(await refusalOf(findPendingResetToken('ann@example.com', NOW))).toBe('noResetToken')
  })

  it('refuses an unknown address', async () => {
    expect(await refusalOf(findPendingResetToken('none@example.com', NOW))).toBe('userNotFound')
  })
})

describe('assertEmailUnverified', () => {
  it('passes for an unverified account', async () => {
    await user('ann')

    await expect(assertEmailUnverified('ann@example.com')).resolves.toBeUndefined()
  })

  it('refuses a verified account and an unknown address', async () => {
    await user('ann', { emailVerified: true })

    expect(await refusalOf(assertEmailUnverified('ann@example.com'))).toBe('alreadyVerified')
    expect(await refusalOf(assertEmailUnverified('none@example.com'))).toBe('userNotFound')
  })
})

describe('readUserState', () => {
  it("reports the soft-delete columns and counts the user's household rows", async () => {
    const deletedAt = new Date('2026-08-01T00:00:00.000Z')
    await user('ann', { deletedAt })
    await prisma.user.update({
      where: { id: 'ann' },
      data: { purgeScheduledFor: new Date('2026-08-31T03:00:00.000Z') },
    })
    await user('bob')
    const alder = await prisma.household.create({
      data: { name: 'Alder', members: { create: [{ userId: 'ann', role: 'owner' }] } },
    })
    const birch = await prisma.household.create({
      data: { name: 'Birch', members: { create: [{ userId: 'bob', role: 'owner' }] } },
    })
    await prisma.session.create({
      data: {
        id: 's-ann',
        token: 't-ann',
        userId: 'ann',
        expiresAt: new Date(NOW.getTime() + HOUR_MS),
      },
    })
    await prisma.mealPlan.create({ data: { householdId: alder.id } })
    await prisma.mealPlan.create({ data: { householdId: birch.id } })
    for (const id of ['g-1', 'g-2']) {
      await prisma.ingredient.create({
        data: {
          id,
          name: id,
          category: 'vegetable',
          defaultUnit: 'g',
          calories: 1,
          protein: 1,
          carbs: 1,
          fat: 1,
        },
      })
      await prisma.pantryItem.create({ data: { householdId: alder.id, ingredientId: id } })
    }
    await prisma.pantryItem.create({ data: { householdId: birch.id, ingredientId: 'g-1' } })

    expect(await readUserState('ann@example.com')).toEqual({
      exists: true,
      emailVerified: false,
      deletedAt,
      purgeScheduledFor: new Date('2026-08-31T03:00:00.000Z'),
      householdIds: [alder.id],
      sessions: 1,
      memberships: 1,
      households: 1,
      pantryItems: 2,
      mealPlans: 1,
    })
  })

  it('reports zero household rows for a user with no household', async () => {
    await user('ann')

    expect(await readUserState('ann@example.com')).toMatchObject({
      exists: true,
      householdIds: [],
      memberships: 0,
      households: 0,
      pantryItems: 0,
      mealPlans: 0,
    })
  })

  it('reports a purged account as a bare exists: false', async () => {
    expect(await readUserState('gone@example.com')).toEqual({ exists: false })
  })
})

describe('readHouseholdState', () => {
  it('counts members, pantry items and plans while the household survives', async () => {
    await user('ann')
    const alder = await prisma.household.create({
      data: {
        name: 'Alder',
        members: {
          create: [
            { userId: 'ann', role: 'owner' },
            { name: 'Kid', role: 'member' },
          ],
        },
      },
    })
    await prisma.mealPlan.create({ data: { householdId: alder.id } })

    expect(await readHouseholdState(alder.id)).toEqual({
      exists: true,
      members: 2,
      pantryItems: 0,
      mealPlans: 1,
    })
  })

  it('reports a purged household as a bare exists: false', async () => {
    expect(await readHouseholdState('hh-gone')).toEqual({ exists: false })
  })
})

describe('expirePurge', () => {
  it('back-dates the purge of a soft-deleted account to a minute before now', async () => {
    await user('ann', { deletedAt: new Date('2026-10-01T00:00:00.000Z') })

    expect(await expirePurge('ann@example.com', NOW)).toBe(1)

    const { purgeScheduledFor } = await prisma.user.findUniqueOrThrow({ where: { id: 'ann' } })
    expect(purgeScheduledFor).toEqual(new Date('2026-10-15T11:59:00.000Z'))
  })

  it('refuses a live account and leaves it unscheduled', async () => {
    await user('ann')

    expect(await refusalOf(expirePurge('ann@example.com', NOW))).toBe('noSoftDeletedUser')
    const { purgeScheduledFor } = await prisma.user.findUniqueOrThrow({ where: { id: 'ann' } })
    expect(purgeScheduledFor).toBeNull()
  })

  it('refuses an unknown address', async () => {
    expect(await refusalOf(expirePurge('none@example.com', NOW))).toBe('noSoftDeletedUser')
  })
})
