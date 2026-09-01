import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    householdMember: {
      findFirst: vi.fn(),
      count: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import { getCachedMembership, getHasHousehold, getHouseholdIdForUser } from '@/lib/session'
import { getLocale } from '@/lib/i18n/get-locale'
import { auth } from '@/lib/auth'

const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockCount = vi.mocked(prisma.householdMember.count)
const mockGetSession = vi.mocked(auth.api.getSession)

type Membership = Awaited<ReturnType<typeof getCachedMembership>>

const MEMBERSHIP = {
  householdId: 'household-1',
  household: { locale: 'et' },
} as unknown as NonNullable<Membership>

/**
 * `findFirst`'s mock is typed against the full `HouseholdMember` model, while
 * `getCachedMembership` narrows it with a `select`. Resolve through here so the
 * fixture stays the narrow shape the production code actually reads.
 */
function resolveMembership(value: Membership) {
  mockFindFirst.mockResolvedValue(value as never)
}

describe('session household accessors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads householdId and household locale in one query', async () => {
    resolveMembership(MEMBERSHIP)

    await getCachedMembership('user-1')

    // Both facts come off a single row — that is what lets the layout, the
    // header, and `getLocale` share one `household_member` read per request.
    expect(mockFindFirst).toHaveBeenCalledTimes(1)
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { householdId: true, household: { select: { locale: true } } },
    })
  })

  it('derives getHouseholdIdForUser and getHasHousehold from that row', async () => {
    resolveMembership(MEMBERSHIP)

    await expect(getHouseholdIdForUser('user-1')).resolves.toBe('household-1')
    await expect(getHasHousehold('user-1')).resolves.toBe(true)

    // `getHasHousehold` used to issue its own `count` — it must not any more,
    // or `<Header />` reintroduces a third query against the same row.
    expect(mockCount).not.toHaveBeenCalled()
  })

  it('reports no household when the row is absent', async () => {
    resolveMembership(null)

    await expect(getHouseholdIdForUser('user-1')).resolves.toBeNull()
    await expect(getHasHousehold('user-1')).resolves.toBe(false)
  })

  it('resolves the locale off the same membership row', async () => {
    resolveMembership(MEMBERSHIP)
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
    } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>)

    await expect(getLocale()).resolves.toBe('et')
    expect(mockCount).not.toHaveBeenCalled()
  })

  it('falls back to Accept-Language for a signed-out request', async () => {
    mockGetSession.mockResolvedValue(null)

    await expect(getLocale()).resolves.toBe('en')
    expect(mockFindFirst).not.toHaveBeenCalled()
  })
})
