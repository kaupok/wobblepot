import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}))

import { purgeUser } from './purge-user'
import { prisma } from '@/lib/prisma'
import { getStartOfTodayInTimezone } from '@/lib/meal-planning/dates'

const mockTransaction = vi.mocked(prisma.$transaction)

/**
 * Builds a fake transaction client and wires `prisma.$transaction` to invoke
 * the cascade against it, mirroring the pattern in the route test. Returns the
 * individual mocks so each test can assert which branch ran.
 */
function mockTx(opts: {
  memberships: Array<{
    id: string
    householdId: string
    role: 'owner' | 'member'
    household?: { timezone: string }
  }>
  memberCount?: number
}) {
  const householdDelete = vi.fn()
  const memberDelete = vi.fn()
  const sessionDeleteMany = vi.fn()
  const accountDeleteMany = vi.fn()
  const userDelete = vi.fn()
  const entryUpdateMany = vi.fn()

  mockTransaction.mockImplementation(async (fn) => {
    const tx = {
      householdMember: {
        findMany: vi.fn().mockResolvedValue(
          opts.memberships.map((m) => ({
            household: { timezone: 'Europe/Tallinn' },
            ...m,
          })),
        ),
        count: vi.fn().mockResolvedValue(opts.memberCount ?? 1),
        delete: memberDelete,
      },
      household: { delete: householdDelete },
      mealPlanEntry: { updateMany: entryUpdateMany },
      session: { deleteMany: sessionDeleteMany },
      account: { deleteMany: accountDeleteMany },
      user: { delete: userDelete },
    }
    return (fn as (tx: unknown) => unknown)(tx)
  })

  return {
    householdDelete,
    memberDelete,
    sessionDeleteMany,
    accountDeleteMany,
    userDelete,
    entryUpdateMany,
  }
}

describe('purgeUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes sessions, accounts, and the user row', async () => {
    const m = mockTx({ memberships: [] })

    await purgeUser('user-123')

    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(m.sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-123' } })
    expect(m.accountDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-123' } })
    expect(m.userDelete).toHaveBeenCalledWith({ where: { id: 'user-123' } })
  })

  it('deletes the household when the user is the sole remaining member', async () => {
    const m = mockTx({
      memberships: [{ id: 'member-1', householdId: 'hh-1', role: 'owner' }],
      memberCount: 1,
    })

    await purgeUser('user-123')

    expect(m.householdDelete).toHaveBeenCalledWith({ where: { id: 'hh-1' } })
    expect(m.memberDelete).not.toHaveBeenCalled()
  })

  it('only removes membership for a non-owner member, leaving the household', async () => {
    const m = mockTx({
      memberships: [{ id: 'member-2', householdId: 'hh-1', role: 'member' }],
    })

    await purgeUser('user-456')

    expect(m.memberDelete).toHaveBeenCalledWith({ where: { id: 'member-2' } })
    expect(m.householdDelete).not.toHaveBeenCalled()
  })

  it('drops only the membership when an owner still has co-members (defensive branch)', async () => {
    const m = mockTx({
      memberships: [{ id: 'member-3', householdId: 'hh-1', role: 'owner' }],
      memberCount: 2,
    })

    await purgeUser('user-789')

    expect(m.memberDelete).toHaveBeenCalledWith({ where: { id: 'member-3' } })
    expect(m.householdDelete).not.toHaveBeenCalled()
  })

  // The remaining members are now a smaller household, and the cached prep tips
  // on every entry without a `servingOverride` were priced at the old count
  // (HON-684).
  it.each([
    ['a non-owner member', 'member' as const, undefined],
    ['an owner with co-members', 'owner' as const, 2],
  ])(
    'clears the surviving household future preparation tips when %s leaves',
    async (_case, role, memberCount) => {
      const m = mockTx({
        memberships: [{ id: 'member-2', householdId: 'hh-1', role }],
        memberCount,
      })

      await purgeUser('user-456')

      expect(m.householdDelete).not.toHaveBeenCalled()
      expect(m.entryUpdateMany).toHaveBeenCalledTimes(1)
      expect(m.entryUpdateMany).toHaveBeenCalledWith({
        where: {
          plan: { householdId: 'hh-1' },
          servingOverride: null,
          preparationTips: { not: null },
          date: { gte: getStartOfTodayInTimezone('Europe/Tallinn') },
        },
        data: { preparationTips: null },
      })
    },
  )

  // The household row is gone and `onDelete: Cascade` took its plans and
  // entries with it, so there is nothing left to invalidate.
  it('does not touch entries when the household is deleted with the user', async () => {
    const m = mockTx({
      memberships: [{ id: 'member-1', householdId: 'hh-1', role: 'owner' }],
      memberCount: 1,
    })

    await purgeUser('user-123')

    expect(m.householdDelete).toHaveBeenCalledWith({ where: { id: 'hh-1' } })
    expect(m.entryUpdateMany).not.toHaveBeenCalled()
  })

  // The cutoff comes from the household's own timezone, read alongside the
  // membership, rather than from the server's clock. Pinned to an instant where
  // Honolulu is still on the previous date from Tallinn's point of view, so a
  // hardcoded zone would produce a visibly different cutoff.
  it('bounds the invalidation by the household timezone', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-20T22:30:00Z'))

      const m = mockTx({
        memberships: [
          {
            id: 'member-2',
            householdId: 'hh-1',
            role: 'member',
            household: { timezone: 'Pacific/Honolulu' },
          },
        ],
      })

      await purgeUser('user-456')

      expect(m.entryUpdateMany.mock.calls[0]?.[0].where.date).toEqual({
        gte: getStartOfTodayInTimezone('Pacific/Honolulu'),
      })
      expect(m.entryUpdateMany.mock.calls[0]?.[0].where.date.gte).not.toEqual(
        getStartOfTodayInTimezone('Europe/Tallinn'),
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
