import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Prisma } from '@/generated/prisma/client'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

vi.mock('@/lib/meal-planning/preparation-steps-cache', () => ({
  invalidateFutureEntrySteps: vi.fn(),
}))

vi.mock('@/lib/meal-images/storage', () => ({
  discardMealImage: vi.fn(),
}))

const capture = vi.fn()
vi.mock('@/lib/posthog-server', () => ({
  getPosthogServer: () => ({ capture }),
}))

vi.mock('@/lib/posthog-purge', () => ({
  deletePosthogPersons: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

import { invalidateFutureEntrySteps } from '@/lib/meal-planning/preparation-steps-cache'
import { discardMealImage } from '@/lib/meal-images/storage'
import { deletePosthogPersons } from '@/lib/posthog-purge'
import { captureApiError } from '@/lib/errors'
import {
  afterHouseholdLeft,
  leaveHousehold,
  lockHouseholdsForMove,
  NotInHouseholdError,
  OwnerHasOtherAccountsError,
} from './household-leave'

const tx = {
  $queryRaw: vi.fn(),
  householdMember: {
    findFirst: vi.fn(),
    count: vi.fn(),
    delete: vi.fn(),
  },
  meal: { findMany: vi.fn() },
  household: { delete: vi.fn() },
}
const txClient = tx as unknown as Prisma.TransactionClient

const membership = (role: 'owner' | 'member') => ({
  id: 'member-1',
  householdId: 'household-1',
  role,
  household: { timezone: 'Europe/Tallinn' },
})

describe('leaveHousehold', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('throws NotInHouseholdError before any write when the user has no membership', async () => {
    tx.householdMember.findFirst.mockResolvedValue(null)

    await expect(leaveHousehold(txClient, 'user-1')).rejects.toBeInstanceOf(NotInHouseholdError)
    expect(tx.householdMember.delete).not.toHaveBeenCalled()
    expect(tx.household.delete).not.toHaveBeenCalled()
  })

  it('deletes only the member row of a member and keeps the household', async () => {
    tx.householdMember.findFirst.mockResolvedValue(membership('member'))

    const result = await leaveHousehold(txClient, 'user-1')

    expect(tx.householdMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    )
    expect(tx.householdMember.delete).toHaveBeenCalledWith({ where: { id: 'member-1' } })
    expect(tx.household.delete).not.toHaveBeenCalled()
    // The household got smaller, so its cached prep tips are re-priced (HON-684).
    expect(invalidateFutureEntrySteps).toHaveBeenCalledWith(tx, 'household-1', 'Europe/Tallinn')
    expect(result).toEqual({
      householdId: 'household-1',
      role: 'member',
      deletedHousehold: false,
      imageUrls: [],
    })
  })

  it('deletes the household of an owner who is the only account holder', async () => {
    tx.householdMember.findFirst.mockResolvedValue(membership('owner'))
    tx.householdMember.count.mockResolvedValue(1)
    tx.meal.findMany.mockResolvedValue([{ imageUrl: 'https://blob/a.png' }, { imageUrl: null }])

    const order: string[] = []
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      order.push(strings.join('?'))
      return []
    })
    tx.householdMember.count.mockImplementation(async () => {
      order.push('count')
      return 1
    })

    const result = await leaveHousehold(txClient, 'user-1')

    // The household row is locked before the count, so an invite claim into
    // it cannot commit unseen between the count and the delete.
    expect(order[0]).toMatch(/FROM "household" WHERE "id" = \? FOR UPDATE/)
    expect(order[1]).toBe('count')
    expect(tx.householdMember.count).toHaveBeenCalledWith({
      where: { householdId: 'household-1', userId: { not: null } },
    })
    expect(tx.household.delete).toHaveBeenCalledWith({ where: { id: 'household-1' } })
    expect(tx.householdMember.delete).not.toHaveBeenCalled()
    expect(result).toEqual({
      householdId: 'household-1',
      role: 'owner',
      deletedHousehold: true,
      imageUrls: ['https://blob/a.png'],
    })
  })

  it('refuses an owner whose household has other account holders', async () => {
    tx.householdMember.findFirst.mockResolvedValue(membership('owner'))
    tx.householdMember.count.mockResolvedValue(3)

    const error = await leaveHousehold(txClient, 'user-1').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(OwnerHasOtherAccountsError)
    expect((error as OwnerHasOtherAccountsError).otherAccountCount).toBe(2)
    expect(tx.household.delete).not.toHaveBeenCalled()
    expect(tx.householdMember.delete).not.toHaveBeenCalled()
  })
})

describe('lockHouseholdsForMove', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  const lockedIds = () =>
    tx.$queryRaw.mock.calls.map(([strings, id]) => {
      expect((strings as TemplateStringsArray).join('?')).toMatch(/FOR UPDATE/)
      return id
    })

  it('locks the current and the target household in id order', async () => {
    tx.householdMember.findFirst.mockResolvedValue({ householdId: 'household-b' })

    await lockHouseholdsForMove(txClient, 'user-1', 'household-a')

    // The same order from either side, so two crossed moves queue instead of
    // deadlocking (HON-1133).
    expect(lockedIds()).toEqual(['household-a', 'household-b'])
  })

  it('locks only the target when the user has no household', async () => {
    tx.householdMember.findFirst.mockResolvedValue(null)

    await lockHouseholdsForMove(txClient, 'user-1', 'household-a')

    expect(lockedIds()).toEqual(['household-a'])
  })

  it('locks a household once when the invite is into the current one', async () => {
    tx.householdMember.findFirst.mockResolvedValue({ householdId: 'household-a' })

    await lockHouseholdsForMove(txClient, 'user-1', 'household-a')

    expect(lockedIds()).toEqual(['household-a'])
  })
})

describe('afterHouseholdLeft', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  const CONTEXT = { route: '/api/households/me/leave', userId: 'user-1' }

  it('discards the images, erases the PostHog household and records a personless event', async () => {
    await afterHouseholdLeft(
      {
        householdId: 'household-1',
        role: 'owner',
        deletedHousehold: true,
        imageUrls: ['https://blob/a.png'],
      },
      CONTEXT,
    )

    expect(discardMealImage).toHaveBeenCalledWith('https://blob/a.png', '/api/households/me/leave')
    expect(deletePosthogPersons).toHaveBeenCalledWith(['household-1'], { userId: 'user-1' })
    expect(capture).toHaveBeenCalledWith({
      distinctId: 'household-1',
      event: 'household:member_left',
      properties: {
        household_id: 'household-1',
        role: 'owner',
        deleted_household: true,
        $process_person_profile: false,
      },
    })
  })

  it('leaves PostHog alone when the household stays', async () => {
    await afterHouseholdLeft(
      { householdId: 'household-1', role: 'member', deletedHousehold: false, imageUrls: [] },
      CONTEXT,
    )

    expect(deletePosthogPersons).not.toHaveBeenCalled()
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ deleted_household: false }),
      }),
    )
  })

  it('captures a failed PostHog erasure with the household id and does not throw', async () => {
    vi.mocked(deletePosthogPersons).mockRejectedValue(new Error('PostHog down'))

    await expect(
      afterHouseholdLeft(
        { householdId: 'household-1', role: 'owner', deletedHousehold: true, imageUrls: [] },
        CONTEXT,
      ),
    ).resolves.toBeUndefined()

    expect(captureApiError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ userId: 'user-1', distinctIds: ['household-1'] }),
    )
    expect(capture).toHaveBeenCalled()
  })
})
