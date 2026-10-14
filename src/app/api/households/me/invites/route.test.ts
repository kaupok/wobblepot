import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST, GET } from './route'

// Every query and the owner rule live in `@/lib/household-invite`, tested
// against a database in `household-invite.db.test.ts`. This file mocks that
// module at the seam and asserts what the route owns: the session, the
// household, the body, and the status and body each answer maps to (HON-1215).

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/household-invite', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/household-invite')>()),
  createHouseholdInvite: vi.fn(),
  listHouseholdInvites: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import {
  createHouseholdInvite,
  HouseholdInviteError,
  listHouseholdInvites,
} from '@/lib/household-invite'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockCreateInvite = vi.mocked(createHouseholdInvite)
const mockListInvites = vi.mocked(listHouseholdInvites)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const mockMembership = {
  id: 'member-owner',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
} as never

const INVITE = {
  id: 'invite-123',
  code: 'abc123xyz456',
  url: 'https://wobblepot.com/invite/abc123xyz456',
  memberId: 'member-456',
  memberName: 'Baby',
  expiresAt: '2030-01-08T00:00:00.000Z',
  createdAt: '2030-01-01T00:00:00.000Z',
}

const URL = 'http://localhost/api/households/me/invites'
const post = (body?: unknown) =>
  POST(
    new Request(URL, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(mockMembership)
})

describe('POST /api/households/me/invites', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await post({ memberId: 'member-456' })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mockCreateInvite).not.toHaveBeenCalled()
  })

  it('returns 404 when no household found', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await post({ memberId: 'member-456' })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
    expect(mockCreateInvite).not.toHaveBeenCalled()
  })

  it('returns 400 when memberId is missing', async () => {
    const response = await post({})
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid request body')
    expect(data.details.memberId).toHaveLength(1)
    expect(mockCreateInvite).not.toHaveBeenCalled()
  })

  it('returns 400 when expiresInDays is out of range', async () => {
    const response = await post({ memberId: 'member-456', expiresInDays: 31 })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.details.expiresInDays).toHaveLength(1)
    expect(mockCreateInvite).not.toHaveBeenCalled()
  })

  it('returns 400 for an empty body, which defaults to no memberId', async () => {
    const response = await post()

    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Invalid request body')
  })

  it('returns 403 when user is not owner', async () => {
    mockCreateInvite.mockRejectedValue(new HouseholdInviteError('notOwner'))

    const response = await post({ memberId: 'member-456' })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Only household owners can create invites' })
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('returns 404 when member not found', async () => {
    mockCreateInvite.mockRejectedValue(new HouseholdInviteError('memberNotFound'))

    const response = await post({ memberId: 'member-456' })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Member not found' })
  })

  it('returns 400 when member already has a user account', async () => {
    mockCreateInvite.mockRejectedValue(new HouseholdInviteError('memberClaimed'))

    const response = await post({ memberId: 'member-456' })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Can only create invites for manual members (members without a linked user account)',
    })
  })

  it('creates the invite with a 7-day default and returns 201 with it', async () => {
    mockCreateInvite.mockResolvedValue(INVITE)

    const response = await post({ memberId: 'member-456' })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(INVITE)
    expect(mockCreateInvite).toHaveBeenCalledWith(mockMembership, 'member-456', 7)
  })

  it('passes the requested expiry through', async () => {
    mockCreateInvite.mockResolvedValue(INVITE)

    await post({ memberId: 'member-456', expiresInDays: 30 })

    expect(mockCreateInvite).toHaveBeenCalledWith(mockMembership, 'member-456', 30)
  })

  it('returns 500 and reports an unexpected failure', async () => {
    mockCreateInvite.mockRejectedValue(new Error('connection lost'))

    const response = await post({ memberId: 'member-456' })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to create invite' })
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/households/me/invites', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 404 when no household found', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await GET()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
    expect(mockListInvites).not.toHaveBeenCalled()
  })

  it('returns 403 when user is not owner', async () => {
    mockListInvites.mockRejectedValue(new HouseholdInviteError('notOwner'))

    const response = await GET()

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Only household owners can view invites' })
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it("returns the household's invites", async () => {
    const invites = [{ ...INVITE, isActive: true }]
    mockListInvites.mockResolvedValue(invites)

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ invites })
    expect(mockListInvites).toHaveBeenCalledWith(mockMembership)
  })

  it('returns 500 and reports an unexpected failure', async () => {
    mockListInvites.mockRejectedValue(new Error('connection lost'))

    const response = await GET()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to fetch invites' })
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })
})
