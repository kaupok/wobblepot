import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, POST } from './route'

// The member list and the add live in `@/lib/household/members`, tested
// against a database in `members.db.test.ts`: the household-size cap, the row
// lock and the prep-tips clear are proved there. This file mocks that module
// at the seam and asserts what the route owns: the session, the household,
// the owner check, body validation, and the status and body each answer maps
// to (HON-1214).

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/household', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/household')>()),
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/household/members', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/household/members')>()),
  listHouseholdMembers: vi.fn(),
  addMember: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership, MAX_HOUSEHOLD_MEMBERS } from '@/lib/household'
import { addMember, listHouseholdMembers, MemberChangeError } from '@/lib/household/members'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockList = vi.mocked(listHouseholdMembers)
const mockAdd = vi.mocked(addMember)

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

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/households/me/members', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

async function answer(response: Promise<Response>) {
  const res = await response
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(membership())
})

describe('GET /api/households/me/members', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(GET())).toEqual({ status: 401, body: { error: 'Unauthorized' } })
    expect(mockList).not.toHaveBeenCalled()
  })

  it('returns 404 when no household found', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(GET())).toEqual({ status: 404, body: { error: 'No household found' } })
    expect(mockList).not.toHaveBeenCalled()
  })

  it("returns the household id and the caller's household's members", async () => {
    const members = [{ id: 'member-123', name: null, role: 'owner' }]
    mockList.mockResolvedValue(members as never)

    expect(await answer(GET())).toEqual({
      status: 200,
      body: { householdId: 'household-123', members },
    })
    expect(mockList).toHaveBeenCalledWith('household-123')
  })

  it('returns 500 and logs when the list throws', async () => {
    mockList.mockRejectedValue(new Error('db down'))

    expect(await answer(GET())).toEqual({
      status: 500,
      body: { error: 'Failed to fetch members' },
    })
    expect(captureApiError).toHaveBeenCalled()
  })
})

describe('POST /api/households/me/members', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(post({ name: 'Kid' }))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    })
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('returns 404 when no household found', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect((await answer(post({ name: 'Kid' }))).status).toBe(404)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('returns 403 when a member who is not the owner adds a member', async () => {
    mockGetMembership.mockResolvedValue(membership('member'))

    expect(await answer(post({ name: 'Kid' }))).toEqual({
      status: 403,
      body: { error: 'Only the household owner can add members' },
    })
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('returns 400 for a body that is not JSON', async () => {
    expect(await answer(post('not json'))).toEqual({
      status: 400,
      body: { error: 'Invalid JSON' },
    })
  })

  it.each([
    ['an empty name', { name: '' }],
    ['a portion size below 0.5', { name: 'Kid', preferences: { portionMultiplier: 0.25 } }],
    ['an unknown allergen', { name: 'Kid', preferences: { allergens: ['celery'] } }],
  ])('returns 400 for %s', async (_label, body) => {
    const { status, body: json } = await answer(post(body))

    expect(status).toBe(400)
    expect(json.error).toBe('Validation failed')
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('adds the member to the caller household and returns it with 201', async () => {
    const added = { id: 'member-new', name: 'Kid', role: 'member', user: null, invite: null }
    mockAdd.mockResolvedValue(added as never)
    const body = {
      name: 'Kid',
      preferences: { displayName: 'K', portionMultiplier: 0.5, allergens: ['nuts'] },
    }

    expect(await answer(post(body))).toEqual({ status: 201, body: added })
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: 'household-123' }),
      body,
    )
  })

  // HON-720: onboarding creates up to 20 members plus the owner, and such a
  // household must still be able to add.
  it('caps households above the 21 members onboarding can produce', () => {
    expect(MAX_HOUSEHOLD_MEMBERS).toBeGreaterThan(21)
  })

  // `code` is what `AddMemberDialog` localizes from (HON-720).
  it('returns 400 household_full at the cap, without logging', async () => {
    mockAdd.mockRejectedValue(new MemberChangeError('householdFull'))

    expect(await answer(post({ name: 'Kid' }))).toEqual({
      status: 400,
      body: {
        error: 'household_full',
        code: 'household_full',
        message: `This household has reached the limit of ${MAX_HOUSEHOLD_MEMBERS} members.`,
        limit: MAX_HOUSEHOLD_MEMBERS,
      },
    })
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it('returns 500 and logs when the add throws', async () => {
    mockAdd.mockRejectedValue(new Error('db down'))

    expect(await answer(post({ name: 'Kid' }))).toEqual({
      status: 500,
      body: { error: 'Failed to add member' },
    })
    expect(captureApiError).toHaveBeenCalled()
  })
})
