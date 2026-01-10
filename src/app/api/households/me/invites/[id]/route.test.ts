import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DELETE } from './route'

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
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockInviteFindFirst = vi.mocked(prisma.householdInvite.findFirst)
const mockInviteDelete = vi.mocked(prisma.householdInvite.delete)

describe('DELETE /api/households/me/invites/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createRequest = () =>
    new Request('http://localhost/api/households/me/invites/invite-123', {
      method: 'DELETE',
    })

  const createParams = () => Promise.resolve({ id: 'invite-123' })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await DELETE(createRequest(), { params: createParams() })
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

    const response = await DELETE(createRequest(), { params: createParams() })
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

    const response = await DELETE(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Only household owners can revoke invites')
  })

  it('returns 404 when invite not found', async () => {
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
    mockInviteFindFirst.mockResolvedValue(null)

    const response = await DELETE(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Invite not found')
  })

  it('deletes invite and returns 204', async () => {
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
    mockInviteFindFirst.mockResolvedValue({
      id: 'invite-123',
      householdId: 'household-123',
      code: 'abc123',
      expiresAt: new Date(),
      maxUses: 5,
      usesCount: 0,
      createdAt: new Date(),
    })
    mockInviteDelete.mockResolvedValue({} as never)

    const response = await DELETE(createRequest(), { params: createParams() })

    expect(response.status).toBe(204)
    expect(mockInviteDelete).toHaveBeenCalledWith({ where: { id: 'invite-123' } })
  })

  it('only deletes invites from own household', async () => {
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
    // Invite exists but belongs to different household
    mockInviteFindFirst.mockResolvedValue(null)

    const response = await DELETE(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Invite not found')
    expect(mockInviteFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'invite-123',
        householdId: 'household-123',
      },
    })
  })
})
