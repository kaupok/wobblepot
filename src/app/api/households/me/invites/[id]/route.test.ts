import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DELETE } from './route'

// Every query and the owner rule live in `@/lib/household-invite`, tested
// against a database in `household-invite.db.test.ts`, including that another
// household's invite answers not found. This file mocks that module at the
// seam and asserts the status and body each answer maps to (HON-1215).

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
  revokeHouseholdInvite: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { HouseholdInviteError, revokeHouseholdInvite } from '@/lib/household-invite'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockRevoke = vi.mocked(revokeHouseholdInvite)

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

const del = () =>
  DELETE(
    new Request('http://localhost/api/households/me/invites/invite-123', { method: 'DELETE' }),
    { params: Promise.resolve({ id: 'invite-123' }) },
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(mockMembership)
})

describe('DELETE /api/households/me/invites/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await del()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mockRevoke).not.toHaveBeenCalled()
  })

  it('returns 404 when no household found', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await del()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
    expect(mockRevoke).not.toHaveBeenCalled()
  })

  it('returns 403 when user is not owner', async () => {
    mockRevoke.mockRejectedValue(new HouseholdInviteError('notOwner'))

    const response = await del()

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Only household owners can revoke invites' })
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('returns 404 when the invite is not in the household', async () => {
    mockRevoke.mockRejectedValue(new HouseholdInviteError('inviteNotFound'))

    const response = await del()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Invite not found' })
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('revokes the invite and returns 204', async () => {
    mockRevoke.mockResolvedValue()

    const response = await del()

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(mockRevoke).toHaveBeenCalledWith(mockMembership, 'invite-123')
  })

  it('returns 500 and reports an unexpected failure', async () => {
    mockRevoke.mockRejectedValue(new Error('connection lost'))

    const response = await del()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to delete invite' })
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })
})
