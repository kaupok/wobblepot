import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST, GET } from './route'

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
  createHouseholdForUser: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    householdMember: {
      findFirst: vi.fn(),
    },
    householdInvite: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/env', () => ({
  getServerBaseURL: vi.fn(() => 'https://app.honkadori.com'),
}))

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'abc123xyz456'),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockMemberFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockInviteUpsert = vi.mocked(prisma.householdInvite.upsert)
const mockInviteFindMany = vi.mocked(prisma.householdInvite.findMany)

describe('POST /api/households/me/invites', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/invites', {
      method: 'POST',
      body: JSON.stringify({ memberId: 'member-123' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when no household found', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockMemberFindFirst.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/invites', {
      method: 'POST',
      body: JSON.stringify({ memberId: 'member-123' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 403 when user is not owner', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockMemberFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'member',
      household: { id: 'household-123' },
    } as never)

    const request = new Request('http://localhost/api/households/me/invites', {
      method: 'POST',
      body: JSON.stringify({ memberId: 'member-456' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Only household owners can create invites')
  })

  it('returns 400 when memberId is missing', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockMemberFindFirst.mockResolvedValue({
      id: 'owner-member',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: { id: 'household-123' },
    } as never)

    const request = new Request('http://localhost/api/households/me/invites', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid request body')
  })

  it('returns 404 when member not found', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    // First call returns household membership, second call returns null for member lookup
    mockMemberFindFirst
      .mockResolvedValueOnce({
        id: 'owner-member',
        householdId: 'household-123',
        userId: 'user-123',
        role: 'owner',
        household: { id: 'household-123' },
      } as never)
      .mockResolvedValueOnce(null)

    const request = new Request('http://localhost/api/households/me/invites', {
      method: 'POST',
      body: JSON.stringify({ memberId: 'nonexistent-member' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Member not found')
  })

  it('returns 400 when member already has a user account', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockMemberFindFirst
      .mockResolvedValueOnce({
        id: 'owner-member',
        householdId: 'household-123',
        userId: 'user-123',
        role: 'owner',
        household: { id: 'household-123' },
      } as never)
      .mockResolvedValueOnce({
        id: 'member-456',
        householdId: 'household-123',
        userId: 'other-user',
        name: 'Jane',
      } as never)

    const request = new Request('http://localhost/api/households/me/invites', {
      method: 'POST',
      body: JSON.stringify({ memberId: 'member-456' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('Can only create invites for manual members')
  })

  it('creates invite for manual member', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockMemberFindFirst
      .mockResolvedValueOnce({
        id: 'owner-member',
        householdId: 'household-123',
        userId: 'user-123',
        role: 'owner',
        household: { id: 'household-123' },
      } as never)
      .mockResolvedValueOnce({
        id: 'member-456',
        householdId: 'household-123',
        userId: null,
        name: 'Baby',
      } as never)

    const createdAt = new Date('2024-01-01T00:00:00.000Z')
    const expiresAt = new Date('2024-01-08T00:00:00.000Z')

    mockInviteUpsert.mockResolvedValue({
      id: 'invite-123',
      householdId: 'household-123',
      memberId: 'member-456',
      code: 'abc123xyz456',
      expiresAt,
      maxUses: 1,
      usesCount: 0,
      createdAt,
    })

    const request = new Request('http://localhost/api/households/me/invites', {
      method: 'POST',
      body: JSON.stringify({ memberId: 'member-456' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.id).toBe('invite-123')
    expect(data.code).toBe('abc123xyz456')
    expect(data.url).toBe('https://app.honkadori.com/invite/abc123xyz456')
    expect(data.memberId).toBe('member-456')
    expect(data.memberName).toBe('Baby')
    expect(data.maxUses).toBe(1)
    expect(data.usesCount).toBe(0)
  })
})

describe('GET /api/households/me/invites', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when no household found', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockMemberFindFirst.mockResolvedValue(null)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 403 when user is not owner', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockMemberFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'member',
      household: { id: 'household-123' },
    } as never)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Only household owners can view invites')
  })

  it('returns empty list when no invites', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockMemberFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: { id: 'household-123' },
    } as never)
    mockInviteFindMany.mockResolvedValue([])

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.invites).toEqual([])
  })

  it('returns invites with member info and isActive status', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockMemberFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: { id: 'household-123' },
    } as never)

    const now = new Date()
    const futureDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const pastDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    mockInviteFindMany.mockResolvedValue([
      {
        id: 'invite-1',
        householdId: 'household-123',
        memberId: 'member-baby',
        code: 'active123',
        expiresAt: futureDate,
        maxUses: 1,
        usesCount: 0,
        createdAt: new Date('2024-01-01'),
        member: { id: 'member-baby', name: 'Baby' },
      },
      {
        id: 'invite-2',
        householdId: 'household-123',
        memberId: 'member-grandma',
        code: 'expired123',
        expiresAt: pastDate,
        maxUses: 1,
        usesCount: 0,
        createdAt: new Date('2024-01-01'),
        member: { id: 'member-grandma', name: 'Grandma' },
      },
    ] as never)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.invites).toHaveLength(2)

    expect(data.invites[0].code).toBe('active123')
    expect(data.invites[0].memberId).toBe('member-baby')
    expect(data.invites[0].memberName).toBe('Baby')
    expect(data.invites[0].isActive).toBe(true)

    expect(data.invites[1].code).toBe('expired123')
    expect(data.invites[1].memberId).toBe('member-grandma')
    expect(data.invites[1].memberName).toBe('Grandma')
    expect(data.invites[1].isActive).toBe(false)
  })
})
