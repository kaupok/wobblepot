import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, PATCH, DELETE } from './route'

// The member reads and changes live in `@/lib/household/members`, tested
// against a database in `members.db.test.ts`: the refusals and the prep-tips
// clear are proved there. This file mocks that module at the seam and asserts
// what the route owns: the session, the household, the owner check on
// DELETE, body validation, and the status and body each answer maps to
// (HON-1214).

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/household/members', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/household/members')>()),
  getHouseholdMember: vi.fn(),
  updateMember: vi.fn(),
  removeMember: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import {
  getHouseholdMember,
  MemberChangeError,
  removeMember,
  updateMember,
  type MemberChangeRefusal,
} from '@/lib/household/members'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockGetMember = vi.mocked(getHouseholdMember)
const mockUpdate = vi.mocked(updateMember)
const mockRemove = vi.mocked(removeMember)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const membership = (role: 'owner' | 'member' = 'owner') =>
  ({
    id: 'member-123',
    householdId: 'household-123',
    userId: 'user-123',
    role,
    household: { id: 'household-123', timezone: 'Europe/Tallinn', members: [] },
  }) as never

const URL = 'http://localhost/api/households/me/members/member-456'
const params = () => Promise.resolve({ id: 'member-456' })

const get = () => GET(new Request(URL), { params: params() })
const patch = (body: unknown) =>
  PATCH(
    new Request(URL, {
      method: 'PATCH',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: params() },
  )
const del = () => DELETE(new Request(URL, { method: 'DELETE' }), { params: params() })

async function answer(response: Promise<Response>) {
  const res = await response
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(membership())
})

describe.each([
  ['GET', get],
  ['PATCH', () => patch({ name: 'Kid' })],
  ['DELETE', del],
])('%s /api/households/me/members/[id] before the lib', (_method, call) => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(call())).toEqual({ status: 401, body: { error: 'Unauthorized' } })
  })

  it('returns 404 when no household found', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(call())).toEqual({ status: 404, body: { error: 'No household found' } })
    expect(mockGetMember).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
  })
})

describe('GET /api/households/me/members/[id]', () => {
  it("returns the member of the caller's household", async () => {
    const member = { id: 'member-456', name: 'Kid', role: 'member', user: null }
    mockGetMember.mockResolvedValue(member as never)

    expect(await answer(get())).toEqual({ status: 200, body: member })
    expect(mockGetMember).toHaveBeenCalledWith('household-123', 'member-456')
  })

  it('returns 404 when the member is not in the household', async () => {
    mockGetMember.mockResolvedValue(null)

    expect(await answer(get())).toEqual({ status: 404, body: { error: 'Member not found' } })
  })

  it('returns 500 and logs when the read throws', async () => {
    mockGetMember.mockRejectedValue(new Error('db down'))

    expect(await answer(get())).toEqual({ status: 500, body: { error: 'Failed to fetch member' } })
    expect(captureApiError).toHaveBeenCalled()
  })
})

describe('PATCH /api/households/me/members/[id]', () => {
  it('saves the validated patch for the caller and returns the member', async () => {
    const member = { id: 'member-456', name: 'Kiddo', preferences: { portionMultiplier: 0.75 } }
    mockUpdate.mockResolvedValue(member as never)

    expect(
      await answer(patch({ name: 'Kiddo', preferences: { portionMultiplier: 0.75 } })),
    ).toEqual({ status: 200, body: member })
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'member-123', householdId: 'household-123' }),
      'member-456',
      { name: 'Kiddo', preferences: { portionMultiplier: 0.75 } },
    )
  })

  // A blank display name clears it, so the member list falls back to the name.
  it('sends a blank display name as null', async () => {
    mockUpdate.mockResolvedValue({ id: 'member-456' } as never)

    await patch({ preferences: { displayName: '   ' } })

    expect(mockUpdate).toHaveBeenCalledWith(expect.anything(), 'member-456', {
      preferences: { displayName: null },
    })
  })

  // Food rules are household-level (HON-1322): a stale client that still
  // sends member food or macro fields saves the name and portion only.
  it('drops member food and macro fields from the body', async () => {
    mockUpdate.mockResolvedValue({ id: 'member-456' } as never)

    await patch({
      name: 'Kiddo',
      preferences: {
        displayName: 'K',
        portionMultiplier: 0.75,
        targetCalories: 1800,
        targetProtein: 80,
        targetCarbs: 200,
        targetFat: 60,
        dietaryType: 'vegan',
        allergens: ['nuts'],
        restrictions: ['low-salt'],
        excludedIngredients: ['celery'],
        excludedIngredientIds: ['ing-1'],
      },
    })

    expect(mockUpdate).toHaveBeenCalledWith(expect.anything(), 'member-456', {
      name: 'Kiddo',
      preferences: { displayName: 'K', portionMultiplier: 0.75 },
    })
  })

  it('returns 400 for a body that is not JSON', async () => {
    expect(await answer(patch('not json'))).toEqual({
      status: 400,
      body: { error: 'Invalid JSON' },
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['an empty name', { name: '' }],
    ['a portion size above 3', { preferences: { portionMultiplier: 4 } }],
    ['a display name over 50 characters', { preferences: { displayName: 'x'.repeat(51) } }],
  ])('returns 400 for %s', async (_label, body) => {
    const { status, body: json } = await answer(patch(body))

    expect(status).toBe(400)
    expect(json.error).toBe('Validation failed')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it.each<[MemberChangeRefusal, number, string]>([
    ['notFound', 404, 'Member not found'],
    ['notAllowed', 403, 'You can only edit your own preferences'],
    ['linkedName', 400, 'Cannot update name for linked members'],
  ])('maps the %s refusal to %i', async (reason, status, error) => {
    mockUpdate.mockRejectedValue(new MemberChangeError(reason))

    expect(await answer(patch({ name: 'Kid' }))).toEqual({ status, body: { error } })
    expect(captureApiError).not.toHaveBeenCalled()
  })

  // `apiFetch` surfaces `error`; a bare Next.js 500 would not be JSON at all.
  it('returns 500 with the { error } JSON shape and logs when the save throws', async () => {
    mockUpdate.mockRejectedValue(new Error('db down'))

    expect(await answer(patch({ name: 'Kid' }))).toEqual({
      status: 500,
      body: { error: 'Failed to update member' },
    })
    expect(captureApiError).toHaveBeenCalled()
  })
})

describe('DELETE /api/households/me/members/[id]', () => {
  it('returns 403 when a member who is not the owner removes someone', async () => {
    mockGetMembership.mockResolvedValue(membership('member'))

    expect(await answer(del())).toEqual({
      status: 403,
      body: { error: 'Only the household owner can remove members' },
    })
    expect(mockRemove).not.toHaveBeenCalled()
  })

  it("removes the member from the owner's household", async () => {
    mockRemove.mockResolvedValue(undefined)

    expect(await answer(del())).toEqual({ status: 200, body: { success: true } })
    expect(mockRemove).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'member-123', householdId: 'household-123' }),
      'member-456',
    )
  })

  it.each<[MemberChangeRefusal, number, string]>([
    ['notFound', 404, 'Member not found'],
    ['self', 400, 'Cannot remove yourself from the household'],
    ['owner', 400, 'Cannot remove the household owner'],
  ])('maps the %s refusal to %i', async (reason, status, error) => {
    mockRemove.mockRejectedValue(new MemberChangeError(reason))

    expect(await answer(del())).toEqual({ status, body: { error } })
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it('returns 500 with the { error } JSON shape and logs when the delete throws', async () => {
    mockRemove.mockRejectedValue(new Error('db down'))

    expect(await answer(del())).toEqual({
      status: 500,
      body: { error: 'Failed to remove member' },
    })
    expect(captureApiError).toHaveBeenCalled()
  })
})
