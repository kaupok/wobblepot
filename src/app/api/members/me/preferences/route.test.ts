import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, PATCH } from './route'

// The member preferences read, save and prep-tips clear live in
// `@/lib/household/preferences`, tested against a database in
// `preferences.db.test.ts`. This file mocks that module at the seam and
// asserts what the route owns: the session, the household, body validation,
// and the status and body each answer maps to (HON-1213).

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

vi.mock('@/lib/household/preferences', () => ({
  getOrCreateMemberPreferences: vi.fn(),
  updateMemberPreferences: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { getOrCreateMemberPreferences, updateMemberPreferences } from '@/lib/household/preferences'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockGetOrCreate = vi.mocked(getOrCreateMemberPreferences)
const mockUpdate = vi.mocked(updateMemberPreferences)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const PREFERENCES = {
  id: 'member-prefs-123',
  memberId: 'member-123',
  displayName: 'Dad',
  portionMultiplier: 1,
  targetCalories: null,
  targetProtein: null,
  targetCarbs: null,
  targetFat: null,
  dietaryType: null,
  allergens: [],
  restrictions: [],
  excludedIngredients: [],
  excludedIngredientIds: [],
}

const MEMBERSHIP = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'member',
  household: {
    id: 'household-123',
    timezone: 'Europe/Tallinn',
    members: [{ preferences: { portionMultiplier: 1 } }, { preferences: { portionMultiplier: 1 } }],
  },
}

const URL = 'http://localhost/api/members/me/preferences'

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
  mockGetMembership.mockResolvedValue(MEMBERSHIP as never)
})

describe('GET /api/members/me/preferences', () => {
  it('answers 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(GET())).toEqual({ status: 401, body: { error: 'Unauthorized' } })
  })

  it('answers 404 when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(GET())).toEqual({ status: 404, body: { error: 'No household found' } })
  })

  it("answers with the caller's own member preferences", async () => {
    mockGetOrCreate.mockResolvedValue(PREFERENCES as never)

    expect(await answer(GET())).toEqual({ status: 200, body: PREFERENCES })
    expect(mockGetOrCreate).toHaveBeenCalledWith('member-123')
  })

  it('answers 500 and reports a failed read', async () => {
    const failure = new Error('database down')
    mockGetOrCreate.mockRejectedValue(failure)

    expect(await answer(GET())).toEqual({
      status: 500,
      body: { error: 'Failed to fetch member preferences' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/members/me/preferences',
      userId: 'user-123',
    })
  })
})

describe('PATCH /api/members/me/preferences', () => {
  beforeEach(() => {
    mockUpdate.mockImplementation(async (_member, data) => ({ ...PREFERENCES, ...data }) as never)
  })

  it('answers 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(patch({ portionMultiplier: 1.5 }))).toEqual({
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
    ['a portion under 0.5×', { portionMultiplier: 0.4 }, 'portionMultiplier'],
    ['a portion over 3×', { portionMultiplier: 3.5 }, 'portionMultiplier'],
    ['an unknown dietary type', { dietaryType: 'carnivore' }, 'dietaryType'],
    ['a display name over 50 characters', { displayName: 'a'.repeat(51) }, 'displayName'],
    ['a calorie target under 500', { targetCalories: 100 }, 'targetCalories'],
    ['an unknown allergen', { allergens: ['pollen'] }, 'allergens'],
  ])('answers 400 for %s', async (_label, body, field) => {
    const { status, body: answered } = await answer(patch(body))

    expect(status).toBe(400)
    expect(answered.error).toBe('Validation failed')
    expect(Object.keys(answered.details)).toEqual([field])
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('answers 404 when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(patch({ portionMultiplier: 1.5 }))).toEqual({
      status: 404,
      body: { error: 'No household found' },
    })
  })

  it("saves the validated fields on the caller's membership and answers with the row", async () => {
    const body = {
      portionMultiplier: 1.5,
      targetCalories: null,
      dietaryType: 'vegetarian',
      allergens: ['nuts'],
      restrictions: ['low-salt'],
      excludedIngredients: ['cilantro'],
    }

    expect(await answer(patch({ ...body, unknown: 'dropped' }))).toEqual({
      status: 200,
      body: { ...PREFERENCES, ...body },
    })
    expect(mockUpdate).toHaveBeenCalledWith(MEMBERSHIP, body)
  })

  it('saves an empty display name as none, so the member shows under their account name', async () => {
    expect(await answer(patch({ displayName: '' }))).toEqual({
      status: 200,
      body: { ...PREFERENCES, displayName: null },
    })
    expect(mockUpdate).toHaveBeenCalledWith(MEMBERSHIP, { displayName: null })
  })

  it('answers 500 and reports a failed save', async () => {
    const failure = new Error('database down')
    mockUpdate.mockRejectedValue(failure)

    expect(await answer(patch({ portionMultiplier: 1.5 }))).toEqual({
      status: 500,
      body: { error: 'Failed to update member preferences' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/members/me/preferences',
      userId: 'user-123',
    })
  })
})
