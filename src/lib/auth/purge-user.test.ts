import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}))

import { purgeUser } from './purge-user'
import { prisma } from '@/lib/prisma'

const mockTransaction = vi.mocked(prisma.$transaction)

/**
 * Builds a fake transaction client and wires `prisma.$transaction` to invoke
 * the cascade against it, mirroring the pattern in the route test. Returns the
 * individual mocks so each test can assert which branch ran.
 */
function mockTx(opts: {
  memberships: Array<{ id: string; householdId: string; role: 'owner' | 'member' }>
  memberCount?: number
}) {
  const householdDelete = vi.fn()
  const memberDelete = vi.fn()
  const sessionDeleteMany = vi.fn()
  const accountDeleteMany = vi.fn()
  const userDelete = vi.fn()

  mockTransaction.mockImplementation(async (fn) => {
    const tx = {
      householdMember: {
        findMany: vi.fn().mockResolvedValue(opts.memberships),
        count: vi.fn().mockResolvedValue(opts.memberCount ?? 1),
        delete: memberDelete,
      },
      household: { delete: householdDelete },
      session: { deleteMany: sessionDeleteMany },
      account: { deleteMany: accountDeleteMany },
      user: { delete: userDelete },
    }
    return (fn as (tx: unknown) => unknown)(tx)
  })

  return { householdDelete, memberDelete, sessionDeleteMany, accountDeleteMany, userDelete }
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
})
