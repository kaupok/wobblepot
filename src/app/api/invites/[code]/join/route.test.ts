import { describe, it, expect, vi, beforeEach } from 'vitest'
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

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockMemberFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockInviteFindUnique = vi.mocked(prisma.householdInvite.findUnique)
const mockTransaction = vi.mocked(prisma.$transaction)

describe('POST /api/invites/[code]/join', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('returns 400 when user already in a household', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockMemberFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
    } as never)

    const response = await POST(createRequest(), { params: createParams('abc123') })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('already_in_household')
    expect(data.message).toBe(
      'You are already a member of a household. Leave your current household to join another.',
    )
  })

  it('returns 404 when invite code not found', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockMemberFindFirst.mockResolvedValue(null)
    mockInviteFindUnique.mockResolvedValue(null)

    const response = await POST(createRequest(), { params: createParams('invalid') })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('invite_not_found')
    expect(data.message).toBe('Invite code not found.')
  })

  it('returns 400 when invite is expired', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockMemberFindFirst.mockResolvedValue(null)
    mockInviteFindUnique.mockResolvedValue({
      id: 'invite-123',
      householdId: 'household-123',
      memberId: 'member-456',
      code: 'abc123',
      expiresAt: new Date('2020-01-01'), // Expired
      maxUses: 1,
      usesCount: 0,
      household: { id: 'household-123', name: 'Smith Family' },
      member: { id: 'member-456', name: 'Baby' },
    } as never)

    const response = await POST(createRequest(), { params: createParams('abc123') })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('invite_invalid')
    expect(data.message).toBe('This invite has expired or reached its maximum uses.')
  })

  it('returns 400 when invite has reached max uses', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockMemberFindFirst.mockResolvedValue(null)
    mockInviteFindUnique.mockResolvedValue({
      id: 'invite-123',
      householdId: 'household-123',
      memberId: 'member-456',
      code: 'abc123',
      expiresAt: new Date('2030-01-01'), // Not expired
      maxUses: 1,
      usesCount: 1, // Max uses reached
      household: { id: 'household-123', name: 'Smith Family' },
      member: { id: 'member-456', name: 'Baby' },
    } as never)

    const response = await POST(createRequest(), { params: createParams('abc123') })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('invite_invalid')
    expect(data.message).toBe('This invite has expired or reached its maximum uses.')
  })

  it('returns 400 when invite has no member (invalid invite)', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockMemberFindFirst.mockResolvedValue(null)
    mockInviteFindUnique.mockResolvedValue({
      id: 'invite-123',
      householdId: 'household-123',
      memberId: null,
      code: 'abc123',
      expiresAt: new Date('2030-01-01'),
      maxUses: 1,
      usesCount: 0,
      household: { id: 'household-123', name: 'Smith Family' },
      member: null,
    } as never)

    const response = await POST(createRequest(), { params: createParams('abc123') })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('invite_invalid')
    expect(data.message).toBe('This invite is no longer valid.')
  })

  it('successfully claims member profile with valid invite', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockMemberFindFirst.mockResolvedValue(null)
    mockInviteFindUnique.mockResolvedValue({
      id: 'invite-123',
      householdId: 'household-123',
      memberId: 'member-456',
      code: 'abc123',
      expiresAt: new Date('2030-01-01'),
      maxUses: 1,
      usesCount: 0,
      household: { id: 'household-123', name: 'Smith Family' },
      member: { id: 'member-456', name: 'Baby' },
    } as never)
    mockTransaction.mockResolvedValue([{}, {}])

    const response = await POST(createRequest(), { params: createParams('abc123') })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.household.id).toBe('household-123')
    expect(data.household.name).toBe('Smith Family')
    expect(data.member.id).toBe('member-456')
    expect(data.member.name).toBe('Baby')

    // Verify transaction was called to update member and delete invite
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })
})
