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
      create: vi.fn(),
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
const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockInviteCreate = vi.mocked(prisma.householdInvite.create)
const mockInviteFindMany = vi.mocked(prisma.householdInvite.findMany)

describe('POST /api/households/me/invites', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/invites', {
      method: 'POST',
      body: JSON.stringify({}),
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
    mockFindFirst.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/invites', {
      method: 'POST',
      body: JSON.stringify({}),
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
    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'member',
      household: { id: 'household-123' },
    } as never)

    const request = new Request('http://localhost/api/households/me/invites', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Only household owners can create invites')
  })

  it('creates invite with default values', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: { id: 'household-123' },
    } as never)

    const createdAt = new Date('2024-01-01T00:00:00.000Z')
    const expiresAt = new Date('2024-01-08T00:00:00.000Z')

    mockInviteCreate.mockResolvedValue({
      id: 'invite-123',
      householdId: 'household-123',
      code: 'abc123xyz456',
      expiresAt,
      maxUses: 5,
      usesCount: 0,
      createdAt,
    })

    const request = new Request('http://localhost/api/households/me/invites', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.id).toBe('invite-123')
    expect(data.code).toBe('abc123xyz456')
    expect(data.url).toBe('https://app.honkadori.com/invite/abc123xyz456')
    expect(data.maxUses).toBe(5)
    expect(data.usesCount).toBe(0)
  })

  it('creates invite with custom values', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: { id: 'household-123' },
    } as never)

    const createdAt = new Date('2024-01-01T00:00:00.000Z')
    const expiresAt = new Date('2024-01-15T00:00:00.000Z')

    mockInviteCreate.mockResolvedValue({
      id: 'invite-123',
      householdId: 'household-123',
      code: 'abc123xyz456',
      expiresAt,
      maxUses: 10,
      usesCount: 0,
      createdAt,
    })

    const request = new Request('http://localhost/api/households/me/invites', {
      method: 'POST',
      body: JSON.stringify({ expiresInDays: 14, maxUses: 10 }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(mockInviteCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        householdId: 'household-123',
        code: 'abc123xyz456',
        maxUses: 10,
      }),
    })
    expect(data.maxUses).toBe(10)
  })

  it('returns 400 for invalid request body', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: { id: 'household-123' },
    } as never)

    const request = new Request('http://localhost/api/households/me/invites', {
      method: 'POST',
      body: JSON.stringify({ expiresInDays: 0 }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid request body')
  })

  it('returns 400 when maxUses is 0', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: { id: 'household-123' },
    } as never)

    const request = new Request('http://localhost/api/households/me/invites', {
      method: 'POST',
      body: JSON.stringify({ maxUses: 0 }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid request body')
  })

  it('returns 400 when expiresInDays exceeds 30', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: { id: 'household-123' },
    } as never)

    const request = new Request('http://localhost/api/households/me/invites', {
      method: 'POST',
      body: JSON.stringify({ expiresInDays: 31 }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid request body')
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
    mockFindFirst.mockResolvedValue(null)

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
    mockFindFirst.mockResolvedValue({
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
    mockFindFirst.mockResolvedValue({
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

  it('returns invites with isActive status', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue({
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
        code: 'active123',
        expiresAt: futureDate,
        maxUses: 5,
        usesCount: 2,
        createdAt: new Date('2024-01-01'),
      },
      {
        id: 'invite-2',
        householdId: 'household-123',
        code: 'expired123',
        expiresAt: pastDate,
        maxUses: 5,
        usesCount: 1,
        createdAt: new Date('2024-01-01'),
      },
      {
        id: 'invite-3',
        householdId: 'household-123',
        code: 'maxed123',
        expiresAt: futureDate,
        maxUses: 5,
        usesCount: 5,
        createdAt: new Date('2024-01-01'),
      },
    ])

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.invites).toHaveLength(3)

    expect(data.invites[0].code).toBe('active123')
    expect(data.invites[0].isActive).toBe(true)

    expect(data.invites[1].code).toBe('expired123')
    expect(data.invites[1].isActive).toBe(false)

    expect(data.invites[2].code).toBe('maxed123')
    expect(data.invites[2].isActive).toBe(false)
  })

  it('treats invite with null maxUses as unlimited (always active if not expired)', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: { id: 'household-123' },
    } as never)

    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    mockInviteFindMany.mockResolvedValue([
      {
        id: 'invite-unlimited',
        householdId: 'household-123',
        code: 'unlimited123',
        expiresAt: futureDate,
        maxUses: null,
        usesCount: 100,
        createdAt: new Date('2024-01-01'),
      },
    ])

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.invites[0].code).toBe('unlimited123')
    expect(data.invites[0].maxUses).toBeNull()
    expect(data.invites[0].usesCount).toBe(100)
    expect(data.invites[0].isActive).toBe(true)
  })
})
