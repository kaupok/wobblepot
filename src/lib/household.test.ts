import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    householdMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

vi.mock('@/lib/env', () => ({
  getServerBaseURL: () => 'https://wobblepot.test',
}))

import { prisma } from '@/lib/prisma'
import {
  getHouseholdMembership,
  isUserSoleOwnerWithOtherMembers,
  listHouseholdMembers,
} from './household'

const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockCount = vi.mocked(prisma.householdMember.count)
const mockFindMany = vi.mocked(prisma.householdMember.findMany)

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

describe('listHouseholdMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const joinedAt = new Date('2026-01-01T00:00:00.000Z')

  function memberRow(overrides: Record<string, unknown>) {
    return {
      id: 'member-1',
      householdId: 'household-123',
      userId: null,
      name: 'Kid',
      role: 'member',
      joinedAt,
      user: null,
      preferences: null,
      invite: null,
      ...overrides,
    }
  }

  it('reads the household roster oldest member first', async () => {
    mockFindMany.mockResolvedValue([])

    await listHouseholdMembers('household-123')

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId: 'household-123' },
        orderBy: { joinedAt: 'asc' },
      }),
    )
  })

  it('maps an unexpired invite to an active invite URL', async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
    mockFindMany.mockResolvedValue([memberRow({ invite: { code: 'abc123', expiresAt } })] as never)

    const [member] = await listHouseholdMembers('household-123')

    expect(member?.invite).toEqual({
      url: 'https://wobblepot.test/invite/abc123',
      expiresAt: expiresAt.toISOString(),
      isActive: true,
    })
  })

  it('marks an expired invite inactive', async () => {
    const expiresAt = new Date(Date.now() - 60 * 1000)
    mockFindMany.mockResolvedValue([memberRow({ invite: { code: 'old', expiresAt } })] as never)

    const [member] = await listHouseholdMembers('household-123')

    expect(member?.invite?.isActive).toBe(false)
  })

  it('returns null invite and preferences when the member has neither', async () => {
    mockFindMany.mockResolvedValue([memberRow({})] as never)

    const [member] = await listHouseholdMembers('household-123')

    expect(member).toMatchObject({ id: 'member-1', name: 'Kid', invite: null, preferences: null })
  })
})
