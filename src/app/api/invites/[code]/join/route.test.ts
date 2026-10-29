import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Prisma } from '@/generated/prisma/client'

import { POST } from './route'

// The route reads the invite through `@/lib/household-invite` and claims it
// through `@/lib/household-claim`. Both are mocked at the seam, with their
// error classes and `getInviteValidity` / `isMembershipConflict` kept real.
// The claim's writes, its lock and its retry are tested in
// `household-claim.test.ts`; the invite read, including the owner deletion
// probe, in `household-invite.db.test.ts`. This file asserts what the route
// owns: the body, the validity map, the leave, and each status and body
// (HON-1215).

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/household-invite', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/household-invite')>()),
  findHouseholdInvite: vi.fn(),
}))

vi.mock('@/lib/household-claim', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/household-claim')>()),
  runHouseholdClaim: vi.fn(),
  inviteMembershipClaim: vi.fn(),
}))

// The error classes stay real; `household-leave.test.ts` owns the leave rules.
vi.mock('@/lib/household-leave', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/household-leave')>()),
  leaveHousehold: vi.fn(),
  lockHouseholdsForMove: vi.fn(),
  afterHouseholdLeft: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  retryAfterSeconds: vi.fn(() => 60),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import {
  AlreadyInHouseholdError,
  inviteMembershipClaim,
  InviteNoLongerClaimableError,
  runHouseholdClaim,
} from '@/lib/household-claim'
import { findHouseholdInvite } from '@/lib/household-invite'
import {
  afterHouseholdLeft,
  leaveHousehold,
  lockHouseholdsForMove,
  NotInHouseholdError,
  OwnerHasOtherAccountsError,
} from '@/lib/household-leave'
import { checkRateLimit } from '@/lib/rate-limit'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindInvite = vi.mocked(findHouseholdInvite)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockRunHouseholdClaim = vi.mocked(runHouseholdClaim)
const mockInviteMembershipClaim = vi.mocked(inviteMembershipClaim)
const mockLeaveHousehold = vi.mocked(leaveHousehold)
const mockAfterHouseholdLeft = vi.mocked(afterHouseholdLeft)
const mockLockHouseholdsForMove = vi.mocked(lockHouseholdsForMove)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const RATE_ALLOWED = { allowed: true, limit: 3, remaining: 2, resetAt: new Date('2030-01-01') }

/** The transaction client `runHouseholdClaim` hands the route's callback. */
const tx = { transaction: 'client' } as never

/** The claim `inviteMembershipClaim` builds; the route must run it on `tx`. */
const claim = vi.fn<(client: unknown) => Promise<void>>()

const VALID_INVITE = {
  id: 'invite-123',
  householdId: 'household-123',
  memberId: 'member-456',
  code: 'abc123',
  expiresAt: new Date('2030-01-01'),
  maxUses: 1,
  usesCount: 0,
  createdAt: new Date('2026-01-01'),
  // `members` is the owner-pending-deletion probe: empty while the owner's
  // account is live (HON-881).
  household: { id: 'household-123', name: 'Smith Family', members: [] },
  member: { id: 'member-456', name: 'Baby', userId: null },
}

/** The same invite while the household's owner has `deletedAt` set. */
const OWNER_PENDING_DELETION_INVITE = {
  ...VALID_INVITE,
  household: { ...VALID_INVITE.household, members: [{ id: 'owner-member-1' }] },
}

const NO_MEMBER_INVITE = { ...VALID_INVITE, memberId: null, member: null }

const SESSION = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
}

const SUCCESS_BODY = {
  success: true,
  household: { id: 'household-123', name: 'Smith Family' },
  member: { id: 'member-456', name: 'Baby' },
}

const ALREADY_IN_HOUSEHOLD_BODY = {
  error: 'already_in_household',
  message: 'You are already a member of a household. Leave your current household to join another.',
}

const EXPIRED_BODY = {
  error: 'invite_invalid',
  message: 'This invite has expired or has already been used.',
}

const NO_LONGER_VALID_BODY = {
  error: 'invite_invalid',
  message: 'This invite is no longer valid.',
}

const createRequest = (body?: unknown) =>
  new Request('http://localhost/api/invites/abc123/join', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const join = (body?: unknown) =>
  POST(createRequest(body), { params: Promise.resolve({ code: 'abc123' }) })

describe('POST /api/invites/[code]/join', () => {
  beforeEach(() => {
    // resetAllMocks, not clearAllMocks: tests below queue
    // `mockResolvedValueOnce` implementations, and `clearAllMocks` does not
    // drain that queue, so it would leak into the next test.
    vi.resetAllMocks()
    mockGetSession.mockResolvedValue(SESSION as never)
    mockFindInvite.mockResolvedValue(VALID_INVITE)
    claim.mockResolvedValue()
    mockInviteMembershipClaim.mockReturnValue(claim)
    mockRunHouseholdClaim.mockImplementation((_userId, callback) => callback(tx))
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await join()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mockFindInvite).not.toHaveBeenCalled()
  })

  it("claims the invite's member for the user and returns the household", async () => {
    const response = await join()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(SUCCESS_BODY)
    expect(mockFindInvite).toHaveBeenCalledWith('abc123')
    // The claim runs under the joining user's lock (HON-679, HON-838), on the
    // transaction client that lock opened.
    expect(mockInviteMembershipClaim).toHaveBeenCalledWith('user-123', 'member-456', 'invite-123')
    expect(mockRunHouseholdClaim).toHaveBeenCalledWith('user-123', expect.any(Function))
    expect(claim).toHaveBeenCalledWith(tx)
  })

  it('returns 404 when the invite code does not resolve', async () => {
    // A used invite lands here too: claiming deletes the row (HON-680).
    mockFindInvite.mockResolvedValue(null)

    const response = await join()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: 'invite_not_found',
      message: 'Invite code not found.',
    })
    expect(mockRunHouseholdClaim).not.toHaveBeenCalled()
  })

  it('returns 400 when the invite is expired', async () => {
    mockFindInvite.mockResolvedValue({ ...VALID_INVITE, expiresAt: new Date('2020-01-01') })

    const response = await join()

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(EXPIRED_BODY)
    expect(mockRunHouseholdClaim).not.toHaveBeenCalled()
  })

  it('returns 400 when the invite has no member', async () => {
    mockFindInvite.mockResolvedValue(NO_MEMBER_INVITE)

    const response = await join()

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(NO_LONGER_VALID_BODY)
    expect(mockRunHouseholdClaim).not.toHaveBeenCalled()
  })

  it("returns 400 when the invite's member already has an account", async () => {
    mockFindInvite.mockResolvedValue({
      ...VALID_INVITE,
      member: { ...VALID_INVITE.member, userId: 'user-other' },
    })

    const response = await join()

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(NO_LONGER_VALID_BODY)
    expect(mockRunHouseholdClaim).not.toHaveBeenCalled()
  })

  // Members without an account no longer block the owner's deletion, and the
  // purge deletes them with the household. Claiming one during the grace
  // window would add an account holder the purge then leaves in an ownerless
  // household, so the claim is refused, with the exact body an invalid invite
  // gets, so the invitee is not told the owner is leaving (HON-881).
  describe('while the household owner is pending account deletion', () => {
    it('refuses the claim with the same response as an invalid invite', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockFindInvite.mockResolvedValue(OWNER_PENDING_DELETION_INVITE)

      const response = await join()

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual(NO_LONGER_VALID_BODY)
      expect(mockRunHouseholdClaim).not.toHaveBeenCalled()
      expect(mockCaptureApiError).not.toHaveBeenCalled()
      // The reason is logged server-side only.
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('pending account deletion'))
    })

    it('lets the same claim through once the deletion is cancelled', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockFindInvite.mockResolvedValueOnce(OWNER_PENDING_DELETION_INVITE)
      expect((await join()).status).toBe(400)

      // Recovery clears `deletedAt`, so the probe comes back empty.
      const claimed = await join()

      expect(claimed.status).toBe(200)
      expect(mockRunHouseholdClaim).toHaveBeenCalledTimes(1)
    })
  })

  // The claim's sentinels and the unique index's `P2002` are expected client
  // errors: each maps to a body `JoinHouseholdCard` branches on, and none is
  // reported as a server fault.
  describe('when the claim refuses', () => {
    it('returns already_in_household when the user already has a household', async () => {
      claim.mockRejectedValue(new AlreadyInHouseholdError())

      const response = await join()

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual(ALREADY_IN_HOUSEHOLD_BODY)
      expect(mockCaptureApiError).not.toHaveBeenCalled()
    })

    it('returns already_in_household when the unique index rejects the claim (HON-696)', async () => {
      claim.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`userId`)',
          {
            code: 'P2002',
            clientVersion: 'test',
            meta: { modelName: 'HouseholdMember', target: ['userId'] },
          },
        ),
      )

      const response = await join()

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual(ALREADY_IN_HOUSEHOLD_BODY)
      expect(mockCaptureApiError).not.toHaveBeenCalled()
    })

    it('returns invite_invalid when a concurrent join consumed the invite first', async () => {
      // Not `invite_not_found`: the code did resolve, and "expired or already
      // used" is accurate for the loser of a race on a single-use link.
      claim.mockRejectedValue(new InviteNoLongerClaimableError())

      const response = await join()

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual(EXPIRED_BODY)
      expect(mockCaptureApiError).not.toHaveBeenCalled()
    })

    it('returns 500 and reports any other failure', async () => {
      claim.mockRejectedValue(new Error('connection lost'))

      const response = await join()

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Failed to join household' })
      expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
    })
  })

  it('returns 400 for a body that is not JSON', async () => {
    const response = await POST(
      new Request('http://localhost/api/invites/abc123/join', { method: 'POST', body: '{' }),
      { params: Promise.resolve({ code: 'abc123' }) },
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid JSON' })
    expect(mockFindInvite).not.toHaveBeenCalled()
  })

  // A user who already has a household leaves it in the same transaction as
  // the claim (HON-1133).
  describe('with { leaveCurrent: true }', () => {
    const LEFT = {
      householdId: 'household-old',
      role: 'owner' as const,
      deletedHousehold: true,
      imageUrls: ['https://blob/old.png'],
    }

    beforeEach(() => {
      mockLeaveHousehold.mockResolvedValue(LEFT)
      mockCheckRateLimit.mockResolvedValue(RATE_ALLOWED)
    })

    it('leaves on the claim transaction before claiming, then cleans up after commit', async () => {
      const order: string[] = []
      mockLockHouseholdsForMove.mockImplementation(async () => {
        order.push('lock')
      })
      mockLeaveHousehold.mockImplementation(async () => {
        order.push('leave')
        return LEFT
      })
      claim.mockImplementation(async () => {
        order.push('claim')
      })

      const response = await join({ leaveCurrent: true })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(SUCCESS_BODY)
      expect(mockLeaveHousehold).toHaveBeenCalledWith(tx, 'user-123')
      // Both households are locked in one order first, so two crossed moves
      // queue rather than deadlock.
      expect(mockLockHouseholdsForMove).toHaveBeenCalledWith(tx, 'user-123', 'household-123')
      expect(order).toEqual(['lock', 'leave', 'claim'])
      expect(mockCheckRateLimit).toHaveBeenCalledWith('user-123', 'household-leave')
      expect(mockAfterHouseholdLeft).toHaveBeenCalledWith(LEFT, {
        route: '/api/invites/[code]/join',
        userId: 'user-123',
      })
    })

    it('rejects the whole transaction when the claim fails after the leave, so the leave rolls back', async () => {
      let transaction: Promise<unknown> | undefined
      mockRunHouseholdClaim.mockImplementation((_userId, callback) => {
        transaction = callback(tx)
        return transaction
      })
      // The invite was used by someone else between render and click.
      claim.mockRejectedValue(new InviteNoLongerClaimableError())

      const response = await join({ leaveCurrent: true })

      expect(mockLeaveHousehold).toHaveBeenCalledWith(tx, 'user-123')
      // A rejected callback is what makes Prisma roll the interactive
      // transaction back, and the leave with it.
      await expect(transaction).rejects.toBeInstanceOf(InviteNoLongerClaimableError)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual(EXPIRED_BODY)
      // Nothing that assumes a committed leave runs.
      expect(mockAfterHouseholdLeft).not.toHaveBeenCalled()
    })

    it('returns 409 owner_has_other_accounts and claims nothing', async () => {
      mockLeaveHousehold.mockRejectedValue(new OwnerHasOtherAccountsError(1))

      const response = await join({ leaveCurrent: true })

      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: 'owner_has_other_accounts', count: 1 })
      expect(claim).not.toHaveBeenCalled()
      expect(mockCaptureApiError).not.toHaveBeenCalled()
    })

    it('claims as usual when the user has no household to leave', async () => {
      mockLeaveHousehold.mockRejectedValue(new NotInHouseholdError())

      const response = await join({ leaveCurrent: true })

      expect(response.status).toBe(200)
      expect(claim).toHaveBeenCalledWith(tx)
      expect(mockAfterHouseholdLeft).not.toHaveBeenCalled()
    })

    it('refuses an invite into the household being left', async () => {
      mockLeaveHousehold.mockResolvedValue({ ...LEFT, householdId: 'household-123' })

      const response = await join({ leaveCurrent: true })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual(ALREADY_IN_HOUSEHOLD_BODY)
      expect(claim).not.toHaveBeenCalled()
      expect(mockAfterHouseholdLeft).not.toHaveBeenCalled()
    })

    it('does not leave, lock or spend a leave without the flag', async () => {
      const response = await join({})

      expect(response.status).toBe(200)
      expect(mockLeaveHousehold).not.toHaveBeenCalled()
      expect(mockLockHouseholdsForMove).not.toHaveBeenCalled()
      expect(mockCheckRateLimit).not.toHaveBeenCalled()
    })

    it('returns 429 once the user has used their leaves, and claims nothing', async () => {
      mockCheckRateLimit.mockResolvedValue({ ...RATE_ALLOWED, allowed: false, remaining: 0 })

      const response = await join({ leaveCurrent: true })

      expect(response.status).toBe(429)
      expect(response.headers.get('Retry-After')).toBe('60')
      expect(await response.json()).toEqual({
        error: 'rate_limited',
        resetAt: '2030-01-01T00:00:00.000Z',
      })
      expect(mockRunHouseholdClaim).not.toHaveBeenCalled()
    })

    it('does not spend a leave on an invalid invite', async () => {
      mockFindInvite.mockResolvedValue({ ...VALID_INVITE, expiresAt: new Date('2020-01-01') })

      const response = await join({ leaveCurrent: true })

      expect(response.status).toBe(400)
      expect(mockCheckRateLimit).not.toHaveBeenCalled()
    })

    it('returns 400 for a malformed body', async () => {
      const response = await join({ leaveCurrent: 'yes' })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Validation failed' })
      expect(mockRunHouseholdClaim).not.toHaveBeenCalled()
    })
  })
})
