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

import { invalidateFutureEntrySteps } from '@/lib/meal-planning/preparation-steps-cache'
import { discardMealImage } from '@/lib/meal-images/storage'
import {
  afterHouseholdLeft,
  leaveHousehold,
  NotInHouseholdError,
  OwnerHasOtherAccountsError,
} from './household-leave'

const tx = {
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

    const result = await leaveHousehold(txClient, 'user-1')

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

describe('afterHouseholdLeft', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('discards the images and records household:member_left', async () => {
    await afterHouseholdLeft(
      {
        householdId: 'household-1',
        role: 'owner',
        deletedHousehold: true,
        imageUrls: ['https://blob/a.png'],
      },
      '/api/households/me/leave',
    )

    expect(discardMealImage).toHaveBeenCalledWith('https://blob/a.png', '/api/households/me/leave')
    expect(capture).toHaveBeenCalledWith({
      distinctId: 'household-1',
      event: 'household:member_left',
      properties: { household_id: 'household-1', role: 'owner', deleted_household: true },
    })
  })
})
