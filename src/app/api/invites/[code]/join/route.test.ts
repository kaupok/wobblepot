import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { POST } from './route'

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
    // Kept on the mock so the isolation test can assert the route never
    // reaches for the non-transactional client (HON-679).
    householdMember: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    householdInvite: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

// Not mocked away: the route must be seen to delegate its transaction to the
// helper, because that is what pins the isolation level. `household-claim`'s
// own test owns the Serializable / retry assertions. `isMembershipConflict`
// stays real, so the P2002 test below exercises the actual classification.
vi.mock('@/lib/household-claim', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/household-claim')>()),
  runHouseholdClaim: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { captureApiError } from '@/lib/errors'
import { runHouseholdClaim } from '@/lib/household-claim'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockMemberFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockInviteFindUnique = vi.mocked(prisma.householdInvite.findUnique)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockRunHouseholdClaim = vi.mocked(runHouseholdClaim)
const mockPrismaTransaction = vi.mocked(prisma.$transaction)

/**
 * Stand-in for the interactive transaction's `tx` client. The route must do
 * both the membership check and the claim on this object, not on `prisma`.
 */
const tx = {
  householdMember: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  householdInvite: {
    deleteMany: vi.fn(),
  },
}

const VALID_INVITE = {
  id: 'invite-123',
  householdId: 'household-123',
  memberId: 'member-456',
  code: 'abc123',
  expiresAt: new Date('2030-01-01'),
  household: { id: 'household-123', name: 'Smith Family' },
  member: { id: 'member-456', name: 'Baby' },
}

const SESSION = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
}

describe('POST /api/invites/[code]/join', () => {
  beforeEach(() => {
    // resetAllMocks, not clearAllMocks: the retry tests below queue
    // `mockResolvedValueOnce` implementations, and `clearAllMocks` clears call
    // history without draining that queue — it would leak into the next test.
    vi.resetAllMocks()
    tx.householdMember.findFirst.mockResolvedValue(null)
    tx.householdMember.updateMany.mockResolvedValue({ count: 1 })
    tx.householdInvite.deleteMany.mockResolvedValue({ count: 1 })
    // The route uses the interactive form, so the mock has to run the callback
    // rather than resolve an array.
    mockRunHouseholdClaim.mockImplementation((callback: unknown) =>
      (callback as (client: typeof tx) => Promise<unknown>)(tx),
    )
  })

  const createRequest = () =>
    new Request('http://localhost/api/invites/abc123/join', {
      method: 'POST',
    })

  const createParams = (code: string) => Promise.resolve({ code })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(createRequest(), { params: createParams('abc123') })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 400 when the in-transaction check finds an existing membership', async () => {
    mockGetSession.mockResolvedValue(SESSION as never)
    mockInviteFindUnique.mockResolvedValue(VALID_INVITE as never)
    tx.householdMember.findFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-999',
      userId: 'user-123',
      role: 'owner',
    })

    const response = await POST(createRequest(), { params: createParams('abc123') })
    const data = await response.json()

    // The response contract JoinHouseholdCard branches on must not move.
    expect(response.status).toBe(400)
    expect(data.error).toBe('already_in_household')
    expect(data.message).toBe(
      'You are already a member of a household. Leave your current household to join another.',
    )
    // The claim must roll back with it.
    expect(tx.householdMember.updateMany).not.toHaveBeenCalled()
    expect(tx.householdInvite.deleteMany).not.toHaveBeenCalled()
  })

  it('runs the membership check on the transaction client, not on prisma', async () => {
    mockGetSession.mockResolvedValue(SESSION as never)
    mockInviteFindUnique.mockResolvedValue(VALID_INVITE as never)

    await POST(createRequest(), { params: createParams('abc123') })

    // This is the assertion that distinguishes fixed from broken: the check
    // has to share a transaction with the claim, or two concurrent joins can
    // both observe "no membership" and both commit (HON-679).
    expect(tx.householdMember.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-123' },
    })
    expect(mockMemberFindFirst).not.toHaveBeenCalled()
  })

  it('does not report the already-in-household sentinel as a server error', async () => {
    mockGetSession.mockResolvedValue(SESSION as never)
    mockInviteFindUnique.mockResolvedValue(VALID_INVITE as never)
    tx.householdMember.findFirst.mockResolvedValue({ id: 'member-123' })

    const response = await POST(createRequest(), { params: createParams('abc123') })

    // A misread sentinel would fall through to captureApiError and a 500,
    // which the client's `already_in_household` branch cannot read.
    expect(response.status).toBe(400)
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('delegates the claim to runHouseholdClaim rather than opening its own transaction', async () => {
    mockGetSession.mockResolvedValue(SESSION as never)
    mockInviteFindUnique.mockResolvedValue(VALID_INVITE as never)

    await POST(createRequest(), { params: createParams('abc123') })

    // The isolation level is the whole fix, and it lives in the helper — a
    // route that opened its own `$transaction` would silently run at read
    // committed, where this check takes no lock and the race is wide open
    // (HON-679). See household-claim.test.ts for the Serializable/retry
    // assertions themselves.
    expect(mockRunHouseholdClaim).toHaveBeenCalledTimes(1)
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
  })

  it('returns a translated invite_invalid when a concurrent join consumed the invite first', async () => {
    mockGetSession.mockResolvedValue(SESSION as never)
    mockInviteFindUnique.mockResolvedValue(VALID_INVITE as never)
    tx.householdInvite.deleteMany.mockResolvedValue({ count: 0 })

    const response = await POST(createRequest(), { params: createParams('abc123') })
    const data = await response.json()

    // Not a 500, and not the `invite_not_found` 404 either: the code *did*
    // resolve, so "not found" is the wrong diagnosis, and "expired or already
    // used" is accurate for the loser of a race on a single-use link. (Since
    // HON-697 both codes render the same translated copy in
    // `JoinHouseholdCard`, so this distinction is for logs and Sentry.)
    expect(response.status).toBe(400)
    expect(data.error).toBe('invite_invalid')
    expect(data.message).toBe('This invite has expired or has already been used.')
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('returns invite_invalid when the member row was already claimed or deleted', async () => {
    mockGetSession.mockResolvedValue(SESSION as never)
    mockInviteFindUnique.mockResolvedValue(VALID_INVITE as never)
    tx.householdMember.updateMany.mockResolvedValue({ count: 0 })

    const response = await POST(createRequest(), { params: createParams('abc123') })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('invite_invalid')
    // A row that vanished must not be reported as a server fault, and the
    // invite must not be consumed on its way out.
    expect(tx.householdInvite.deleteMany).not.toHaveBeenCalled()
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('maps a unique-index rejection of the claim to already_in_household, not a 500', async () => {
    // A concurrent create or join committed a membership for this user after
    // the in-transaction check ran, and `household_member_userId_key` rejected
    // the claim (HON-696). `JoinHouseholdCard` branches on this exact string.
    mockGetSession.mockResolvedValue(SESSION as never)
    mockInviteFindUnique.mockResolvedValue(VALID_INVITE as never)
    tx.householdMember.updateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`userId`)',
        {
          code: 'P2002',
          clientVersion: 'test',
          meta: { modelName: 'HouseholdMember', target: ['userId'] },
        },
      ),
    )

    const response = await POST(createRequest(), { params: createParams('abc123') })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('already_in_household')
    expect(tx.householdInvite.deleteMany).not.toHaveBeenCalled()
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('returns 500 when the transaction fails for any other reason', async () => {
    mockGetSession.mockResolvedValue(SESSION as never)
    mockInviteFindUnique.mockResolvedValue(VALID_INVITE as never)
    tx.householdMember.updateMany.mockRejectedValue(new Error('connection lost'))

    const response = await POST(createRequest(), { params: createParams('abc123') })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to join household')
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })

  it('returns 404 when invite code not found', async () => {
    mockGetSession.mockResolvedValue(SESSION as never)
    mockInviteFindUnique.mockResolvedValue(null)

    const response = await POST(createRequest(), { params: createParams('invalid') })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('invite_not_found')
    expect(data.message).toBe('Invite code not found.')
    expect(mockRunHouseholdClaim).not.toHaveBeenCalled()
  })

  it('returns 400 when invite is expired', async () => {
    mockGetSession.mockResolvedValue(SESSION as never)
    mockInviteFindUnique.mockResolvedValue({
      ...VALID_INVITE,
      expiresAt: new Date('2020-01-01'), // Expired
    } as never)

    const response = await POST(createRequest(), { params: createParams('abc123') })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('invite_invalid')
    expect(data.message).toBe('This invite has expired or has already been used.')
    expect(mockRunHouseholdClaim).not.toHaveBeenCalled()
  })

  it('returns invite_not_found on a second join with an already-claimed code', async () => {
    // Single use is enforced by deleting the invite row, not by a uses
    // counter (HON-680), so the second join finds no invite at all and never
    // reaches the validity checks.
    mockGetSession.mockResolvedValue(SESSION as never)
    mockInviteFindUnique.mockResolvedValueOnce(VALID_INVITE as never)

    const first = await POST(createRequest(), { params: createParams('abc123') })

    expect(first.status).toBe(200)
    expect(tx.householdInvite.deleteMany).toHaveBeenCalledWith({ where: { id: 'invite-123' } })

    // The row the first join deleted: the code no longer resolves.
    mockInviteFindUnique.mockResolvedValueOnce(null as never)
    mockRunHouseholdClaim.mockClear()

    const second = await POST(createRequest(), { params: createParams('abc123') })
    const data = await second.json()

    expect(second.status).toBe(404)
    expect(data.error).toBe('invite_not_found')
    expect(mockRunHouseholdClaim).not.toHaveBeenCalled()
  })

  it('returns 400 when invite has no member (invalid invite)', async () => {
    mockGetSession.mockResolvedValue(SESSION as never)
    mockInviteFindUnique.mockResolvedValue({
      ...VALID_INVITE,
      memberId: null,
      member: null,
    } as never)

    const response = await POST(createRequest(), { params: createParams('abc123') })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('invite_invalid')
    expect(data.message).toBe('This invite is no longer valid.')
    expect(mockRunHouseholdClaim).not.toHaveBeenCalled()
  })

  it('successfully claims member profile with valid invite', async () => {
    mockGetSession.mockResolvedValue(SESSION as never)
    mockInviteFindUnique.mockResolvedValue(VALID_INVITE as never)

    const response = await POST(createRequest(), { params: createParams('abc123') })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.household.id).toBe('household-123')
    expect(data.household.name).toBe('Smith Family')
    expect(data.member.id).toBe('member-456')
    expect(data.member.name).toBe('Baby')

    // The claim and the invite deletion both happen on the transaction client.
    expect(mockRunHouseholdClaim).toHaveBeenCalledTimes(1)
    // Claim-if-unclaimed: a member row a concurrent join already took must
    // match nothing rather than be silently overwritten.
    expect(tx.householdMember.updateMany).toHaveBeenCalledWith({
      where: { id: 'member-456', userId: null },
      data: { userId: 'user-123' },
    })
    expect(tx.householdInvite.deleteMany).toHaveBeenCalledWith({
      where: { id: 'invite-123' },
    })
  })
})
