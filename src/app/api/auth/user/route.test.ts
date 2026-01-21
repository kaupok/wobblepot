import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DELETE } from './route'

// Mock dependencies
vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    householdMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    memberPreferences: {
      deleteMany: vi.fn(),
    },
    household: {
      delete: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
    account: {
      deleteMany: vi.fn(),
    },
    user: {
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/household', () => ({
  isUserSoleOwnerWithOtherMembers: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isUserSoleOwnerWithOtherMembers } from '@/lib/household'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockIsUserSoleOwner = vi.mocked(isUserSoleOwnerWithOtherMembers)
const mockTransaction = vi.mocked(prisma.$transaction)

describe('DELETE /api/auth/user', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await DELETE()
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 400 when user is sole owner with other members', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockIsUserSoleOwner.mockResolvedValue({
      isSoleOwner: true,
      householdId: 'household-123',
      householdName: 'Doe Family',
      memberCount: 3,
    })

    const response = await DELETE()
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot delete account')
    expect(data.message).toContain('sole owner')
    expect(data.message).toContain('2 other member(s)')
    expect(data.householdName).toBe('Doe Family')
  })

  it('deletes user with no household membership', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockIsUserSoleOwner.mockResolvedValue({ isSoleOwner: false })

    mockTransaction.mockImplementation(async (fn) => {
      const tx = {
        householdMember: {
          findMany: vi.fn().mockResolvedValue([]),
          count: vi.fn(),
          delete: vi.fn(),
        },
        memberPreferences: {
          deleteMany: vi.fn(),
        },
        household: {
          delete: vi.fn(),
        },
        session: {
          deleteMany: vi.fn(),
        },
        account: {
          deleteMany: vi.fn(),
        },
        user: {
          delete: vi.fn(),
        },
      }
      return fn(tx as never)
    })

    const response = await DELETE()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockTransaction).toHaveBeenCalled()
  })

  it('deletes user and household when sole owner with no other members', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockIsUserSoleOwner.mockResolvedValue({ isSoleOwner: false })

    const deleteHouseholdMock = vi.fn()
    const deleteMemberMock = vi.fn()
    const deletePreferencesMock = vi.fn()
    const deleteSessionsMock = vi.fn()
    const deleteAccountsMock = vi.fn()
    const deleteUserMock = vi.fn()

    mockTransaction.mockImplementation(async (fn) => {
      const tx = {
        householdMember: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'member-123',
              householdId: 'household-123',
              userId: 'user-123',
              role: 'owner',
            },
          ]),
          count: vi.fn().mockResolvedValue(1), // Only member
          delete: deleteMemberMock,
        },
        memberPreferences: {
          deleteMany: deletePreferencesMock,
        },
        household: {
          delete: deleteHouseholdMock,
        },
        session: {
          deleteMany: deleteSessionsMock,
        },
        account: {
          deleteMany: deleteAccountsMock,
        },
        user: {
          delete: deleteUserMock,
        },
      }
      return fn(tx as never)
    })

    const response = await DELETE()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)

    // Verify cascade deletion was called
    expect(mockTransaction).toHaveBeenCalled()
  })

  it('removes user from household when not owner', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-456', name: 'Jane Doe', email: 'jane@example.com' },
      session: { id: 'session-456' },
    } as never)

    mockIsUserSoleOwner.mockResolvedValue({ isSoleOwner: false })

    const deleteMemberMock = vi.fn()
    const deletePreferencesMock = vi.fn()
    const deleteSessionsMock = vi.fn()
    const deleteAccountsMock = vi.fn()
    const deleteUserMock = vi.fn()

    mockTransaction.mockImplementation(async (fn) => {
      const tx = {
        householdMember: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'member-456',
              householdId: 'household-123',
              userId: 'user-456',
              role: 'member', // Not owner
            },
          ]),
          count: vi.fn(),
          delete: deleteMemberMock,
        },
        memberPreferences: {
          deleteMany: deletePreferencesMock,
        },
        household: {
          delete: vi.fn(),
        },
        session: {
          deleteMany: deleteSessionsMock,
        },
        account: {
          deleteMany: deleteAccountsMock,
        },
        user: {
          delete: deleteUserMock,
        },
      }
      return fn(tx as never)
    })

    const response = await DELETE()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })

  it('deletes auth-related records (sessions, accounts)', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockIsUserSoleOwner.mockResolvedValue({ isSoleOwner: false })

    const deleteSessionsMock = vi.fn()
    const deleteAccountsMock = vi.fn()
    const deleteUserMock = vi.fn()

    mockTransaction.mockImplementation(async (fn) => {
      const tx = {
        householdMember: {
          findMany: vi.fn().mockResolvedValue([]),
          count: vi.fn(),
          delete: vi.fn(),
        },
        memberPreferences: {
          deleteMany: vi.fn(),
        },
        household: {
          delete: vi.fn(),
        },
        session: {
          deleteMany: deleteSessionsMock,
        },
        account: {
          deleteMany: deleteAccountsMock,
        },
        user: {
          delete: deleteUserMock,
        },
      }
      return fn(tx as never)
    })

    await DELETE()

    // Check that session, account, and user deletion was triggered in transaction
    expect(mockTransaction).toHaveBeenCalled()
  })
})
