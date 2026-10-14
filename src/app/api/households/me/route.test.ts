import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, PATCH } from './route'

// The household update and its prep-tips clear live in `@/lib/household`,
// tested against a database in `household.db.test.ts`. This file mocks that
// module at the seam and asserts what the route owns: the session, the owner
// check, body validation, and the status and body each answer maps to
// (HON-1213).

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
  updateHousehold: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership, updateHousehold } from '@/lib/household'
import { captureApiError } from '@/lib/errors'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockUpdateHousehold = vi.mocked(updateHousehold)
const mockCaptureApiError = vi.mocked(captureApiError)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z')
const PREFERENCES = { id: 'pref-1', dietaryType: null, allergensToAvoid: ['nuts'] }

const household = {
  id: 'household-123',
  name: 'Test Household',
  timezone: 'Europe/Tallinn',
  locale: 'en',
  createdAt: CREATED_AT,
  preferences: PREFERENCES,
}

const membership = (role: 'owner' | 'member' = 'owner') =>
  ({
    id: 'member-123',
    householdId: 'household-123',
    userId: 'user-123',
    role,
    household: { ...household, _count: { members: 2 }, members: [] },
  }) as never

/** The body every success answers with: the household's fields, no member data. */
const answerBody = (fields: Partial<typeof household> = {}) =>
  JSON.parse(JSON.stringify({ ...household, ...fields }))

const URL = 'http://localhost/api/households/me'

const patch = (body: unknown) =>
  PATCH(
    new Request(URL, {
      method: 'PATCH',
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

describe('GET /api/households/me', () => {
  it('answers 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(GET())).toEqual({ status: 401, body: { error: 'Unauthorized' } })
  })

  it('answers 404 when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(GET())).toEqual({ status: 404, body: { error: 'No household found' } })
  })

  it('answers with the household and its preferences', async () => {
    expect(await answer(GET())).toEqual({ status: 200, body: answerBody() })
  })

  it('answers 500 and reports a failed read', async () => {
    const failure = new Error('database down')
    mockGetMembership.mockRejectedValue(failure)

    expect(await answer(GET())).toEqual({
      status: 500,
      body: { error: 'Failed to fetch household' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/households/me',
      userId: 'user-123',
    })
  })
})

describe('PATCH /api/households/me', () => {
  beforeEach(() => {
    mockUpdateHousehold.mockImplementation(
      async (_household, data) =>
        ({
          ...household,
          ...data,
        }) as never,
    )
  })

  it('answers 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(patch({ name: 'New' }))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    })
  })

  it('answers 400 for invalid JSON', async () => {
    expect(await answer(patch('{not json'))).toEqual({
      status: 400,
      body: { error: 'Invalid JSON' },
    })
  })

  it.each([
    ['an empty name', { name: '' }, 'name'],
    ['a name over 100 characters', { name: 'a'.repeat(101) }, 'name'],
    ['an unknown timezone', { timezone: 'Mars/Olympus' }, 'timezone'],
    ['an unknown locale', { locale: 'fr' }, 'locale'],
  ])('answers 400 for %s', async (_label, body, field) => {
    const { status, body: answered } = await answer(patch(body))

    expect(status).toBe(400)
    expect(answered.error).toBe('Validation failed')
    expect(Object.keys(answered.details)).toEqual([field])
    expect(mockUpdateHousehold).not.toHaveBeenCalled()
  })

  it('answers 404 when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(patch({ name: 'New' }))).toEqual({
      status: 404,
      body: { error: 'No household found' },
    })
  })

  it('answers 403 to a member who is not the owner, and saves nothing', async () => {
    mockGetMembership.mockResolvedValue(membership('member'))

    expect(await answer(patch({ name: 'New' }))).toEqual({
      status: 403,
      body: { error: 'forbidden', message: 'Only the household owner can edit these settings.' },
    })
    expect(mockUpdateHousehold).not.toHaveBeenCalled()
  })

  it('saves the validated fields on the stored household and answers with the result', async () => {
    const result = await answer(
      patch({ name: 'Renamed', timezone: 'America/New_York', locale: 'et' }),
    )

    expect(result).toEqual({
      status: 200,
      body: answerBody({ name: 'Renamed', timezone: 'America/New_York', locale: 'et' }),
    })
    const [stored, data] = mockUpdateHousehold.mock.calls[0]!
    expect(stored).toMatchObject({ id: 'household-123', locale: 'en' })
    expect(data).toEqual({ name: 'Renamed', timezone: 'America/New_York', locale: 'et' })
  })

  it('drops unknown fields before saving', async () => {
    await patch({ name: 'Renamed', id: 'other-household', createdAt: 'yesterday' })

    expect(mockUpdateHousehold.mock.calls[0]![1]).toEqual({ name: 'Renamed' })
  })

  it('accepts an empty body as a save of nothing', async () => {
    expect(await answer(patch({}))).toEqual({ status: 200, body: answerBody() })
    expect(mockUpdateHousehold.mock.calls[0]![1]).toEqual({})
  })

  it('answers 500 and reports a failed save', async () => {
    const failure = new Error('database down')
    mockUpdateHousehold.mockRejectedValue(failure)

    expect(await answer(patch({ name: 'Renamed' }))).toEqual({
      status: 500,
      body: { error: 'Failed to update household' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/households/me',
      userId: 'user-123',
    })
  })
})
