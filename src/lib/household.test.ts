import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    householdMember: {
      findFirst: vi.fn(),
      count: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import { getHouseholdMembership, isUserSoleOwnerWithOtherMembers } from './household'

const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockCount = vi.mocked(prisma.householdMember.count)

describe('getHouseholdMembership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the household preferences and member count in one query', async () => {
    mockFindFirst.mockResolvedValue(null)

    await getHouseholdMembership('user-123')

    // The `_count` is what lets `/profile` skip a second `household_member`
    // read (HON-596); Prisma folds it into this same round-trip.
    expect(mockFindFirst).toHaveBeenCalledTimes(1)
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { userId: 'user-123' },
      include: {
        household: {
          include: {
            preferences: true,
            _count: { select: { members: true } },
          },
        },
      },
    })
    expect(mockCount).not.toHaveBeenCalled()
  })

  it('returns null when the user has no membership', async () => {
    mockFindFirst.mockResolvedValue(null)

    await expect(getHouseholdMembership('user-123')).resolves.toBeNull()
  })
})

describe('isUserSoleOwnerWithOtherMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns isSoleOwner: false when user is not an owner', async () => {
    mockFindFirst.mockResolvedValue(null)

    const result = await isUserSoleOwnerWithOtherMembers('user-123')

    expect(result).toEqual({ isSoleOwner: false })
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-123',
        role: 'owner',
      },
      include: {
        household: true,
      },
    })
  })

  it('returns isSoleOwner: false when owner is only member', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: {
        id: 'household-123',
        name: 'Doe Family',
      },
    } as never)

    mockCount.mockResolvedValue(1) // Only member

    const result = await isUserSoleOwnerWithOtherMembers('user-123')

    expect(result).toEqual({ isSoleOwner: false })
  })

  it('returns isSoleOwner: true with details when owner has other members', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: {
        id: 'household-123',
        name: 'Doe Family',
      },
    } as never)

    mockCount.mockResolvedValue(3) // Owner + 2 others

    const result = await isUserSoleOwnerWithOtherMembers('user-123')

    expect(result).toEqual({
      isSoleOwner: true,
      householdId: 'household-123',
      householdName: 'Doe Family',
      memberCount: 3,
    })
  })

  it('counts members from correct household', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-456',
      userId: 'user-123',
      role: 'owner',
      household: {
        id: 'household-456',
        name: 'Test Household',
      },
    } as never)

    mockCount.mockResolvedValue(1)

    await isUserSoleOwnerWithOtherMembers('user-123')

    expect(mockCount).toHaveBeenCalledWith({
      where: { householdId: 'household-456' },
    })
  })
})
