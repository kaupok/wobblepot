import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    householdInvite: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/household-claim', () => ({
  runHouseholdClaim: vi.fn(),
  inviteMembershipClaim: vi.fn(() => 'claim-callback'),
}))

import { prisma } from '@/lib/prisma'
import { inviteMembershipClaim, runHouseholdClaim } from '@/lib/household-claim'
import {
  getHouseholdInviteCodeFromBody,
  getInviteValidity,
  joinHouseholdFromSignUp,
  type HouseholdInviteWithDetails,
} from './household-invite'

const NOW = new Date('2026-10-09T12:00:00Z')

const VALID_INVITE = {
  id: 'invite-1',
  householdId: 'household-1',
  memberId: 'member-1',
  code: 'Ab3_x-9Kq2Lm',
  expiresAt: new Date('2026-10-16T12:00:00Z'),
  maxUses: 1,
  usesCount: 0,
  createdAt: new Date('2026-10-09T10:00:00Z'),
  household: { id: 'household-1', name: 'Smith Family', members: [] },
  member: { id: 'member-1', name: 'Partner', userId: null },
} satisfies HouseholdInviteWithDetails

const mockFindUnique = vi.mocked(prisma.householdInvite.findUnique)
const mockRunHouseholdClaim = vi.mocked(runHouseholdClaim)

describe('getInviteValidity', () => {
  it('accepts an unexpired invite for an unclaimed member', () => {
    expect(getInviteValidity(VALID_INVITE, NOW)).toBe('valid')
  })

  it('rejects an expired invite', () => {
    expect(
      getInviteValidity({ ...VALID_INVITE, expiresAt: new Date('2026-10-09T11:59:59Z') }, NOW),
    ).toBe('expired')
  })

  it('rejects an invite with no member row', () => {
    expect(getInviteValidity({ ...VALID_INVITE, memberId: null, member: null }, NOW)).toBe(
      'no_member',
    )
  })

  it('rejects an invite whose member already has an account', () => {
    expect(
      getInviteValidity(
        { ...VALID_INVITE, member: { ...VALID_INVITE.member, userId: 'u-9' } },
        NOW,
      ),
    ).toBe('member_claimed')
  })

  it('rejects an invite while the owner is pending account deletion (HON-881)', () => {
    expect(
      getInviteValidity(
        { ...VALID_INVITE, household: { ...VALID_INVITE.household, members: [{ id: 'owner-1' }] } },
        NOW,
      ),
    ).toBe('owner_pending_deletion')
  })
})

describe('getHouseholdInviteCodeFromBody', () => {
  it('trims a string code and ignores anything else', () => {
    expect(getHouseholdInviteCodeFromBody({ householdInviteCode: ' abc ' })).toBe('abc')
    expect(getHouseholdInviteCodeFromBody({ householdInviteCode: 7 })).toBe('')
    expect(getHouseholdInviteCodeFromBody({})).toBe('')
    expect(getHouseholdInviteCodeFromBody(null)).toBe('')
  })
})

describe('joinHouseholdFromSignUp (HON-1131)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('claims the member row for the new user through runHouseholdClaim', async () => {
    mockFindUnique.mockResolvedValue(VALID_INVITE as never)
    mockRunHouseholdClaim.mockResolvedValue(undefined)

    await expect(
      joinHouseholdFromSignUp({ householdInviteCode: 'Ab3_x-9Kq2Lm' }, 'user-1'),
    ).resolves.toBe(true)

    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: 'Ab3_x-9Kq2Lm' } }),
    )
    expect(inviteMembershipClaim).toHaveBeenCalledWith('user-1', 'member-1', 'invite-1')
    // The lock must be on the user the claim writes a membership for.
    expect(mockRunHouseholdClaim).toHaveBeenCalledWith('user-1', 'claim-callback')
  })

  it('does nothing without a household invite code', async () => {
    await expect(joinHouseholdFromSignUp({ inviteCode: 'beta' }, 'user-1')).resolves.toBe(false)

    expect(mockFindUnique).not.toHaveBeenCalled()
    expect(mockRunHouseholdClaim).not.toHaveBeenCalled()
  })

  it('keeps the account and logs when another sign-up claimed the invite first', async () => {
    mockFindUnique.mockResolvedValue(null)

    await expect(
      joinHouseholdFromSignUp({ householdInviteCode: 'Ab3_x-9Kq2Lm' }, 'user-1'),
    ).resolves.toBe(false)

    expect(mockRunHouseholdClaim).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(
      '[household-invite] sign-up could not join the household',
      { userId: 'user-1', validity: 'not_found' },
    )
  })

  it('does not throw when the claim transaction fails', async () => {
    mockFindUnique.mockResolvedValue(VALID_INVITE as never)
    mockRunHouseholdClaim.mockRejectedValue(new Error('invite consumed'))

    await expect(
      joinHouseholdFromSignUp({ householdInviteCode: 'Ab3_x-9Kq2Lm' }, 'user-1'),
    ).resolves.toBe(false)

    expect(console.warn).toHaveBeenCalledWith(
      '[household-invite] sign-up could not claim the invite',
      expect.objectContaining({ userId: 'user-1' }),
    )
  })

  it('does not claim an invite that expired between the gate and the claim', async () => {
    mockFindUnique.mockResolvedValue({
      ...VALID_INVITE,
      expiresAt: new Date('2000-01-01'),
    } as never)

    await expect(
      joinHouseholdFromSignUp({ householdInviteCode: 'Ab3_x-9Kq2Lm' }, 'user-1'),
    ).resolves.toBe(false)
    expect(mockRunHouseholdClaim).not.toHaveBeenCalled()
  })
})
