import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GET, PATCH } from './route'

// The preferences save and the conflict count live in
// `@/lib/household/preferences`, tested against a database in
// `preferences.db.test.ts`. This file mocks that module at the seam and
// asserts what the route owns: the session, the owner check, body validation,
// when the conflicts are counted, and the status and body each answer maps to
// (HON-1213).

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
  updateHouseholdPreferences: vi.fn(),
  countConflictingPlannedEntries: vi.fn(),
  matchExcludedIngredients: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import {
  countConflictingPlannedEntries,
  matchExcludedIngredients,
  updateHouseholdPreferences,
} from '@/lib/household/preferences'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockUpdate = vi.mocked(updateHouseholdPreferences)
const mockCountConflicts = vi.mocked(countConflictingPlannedEntries)
const mockMatchExcluded = vi.mocked(matchExcludedIngredients)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const PREFERENCES = {
  id: 'prefs-123',
  householdId: 'household-123',
  dietaryType: null,
  allergensToAvoid: [],
  restrictions: [],
  excludedIngredients: [] as string[],
  excludedIngredientIds: [],
  weekdayMealTypes: ['dinner'],
  weekendMealTypes: ['dinner'],
}

const HOUSEHOLD = { id: 'household-123', name: 'Test', timezone: 'Europe/Tallinn', locale: 'et' }

/** What the lib answers for each tag: one ingredient named after it. */
const matchesFor = (tags: readonly string[]) =>
  tags.map((tag) => ({ tag, ingredients: [{ id: `ing-${tag}`, name: tag }] }))

const membership = ({
  role = 'owner',
  preferences = PREFERENCES as typeof PREFERENCES | null,
} = {}) =>
  ({
    id: 'member-123',
    householdId: 'household-123',
    userId: 'user-123',
    role,
    household: { ...HOUSEHOLD, preferences },
  }) as never

const URL = 'http://localhost/api/households/me/preferences'

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
  mockMatchExcluded.mockImplementation(async (_householdId, tags) => matchesFor(tags))
})

describe('GET /api/households/me/preferences', () => {
  it('answers 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(GET())).toEqual({ status: 401, body: { error: 'Unauthorized' } })
  })

  it('answers 404 when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(GET())).toEqual({ status: 404, body: { error: 'No household found' } })
  })

  it("answers with the household's preferences", async () => {
    expect(await answer(GET())).toEqual({
      status: 200,
      body: { ...PREFERENCES, excludedMatches: [] },
    })
  })

  // The state the seeded smoke household was in (HON-672).
  it('answers 404 when the household has no preferences row', async () => {
    mockGetMembership.mockResolvedValue(membership({ preferences: null }))

    expect(await answer(GET())).toEqual({
      status: 404,
      body: { error: 'No household preferences found' },
    })
  })

  it('answers 500 and reports a failed read', async () => {
    const failure = new Error('database down')
    mockGetMembership.mockRejectedValue(failure)

    expect(await answer(GET())).toEqual({
      status: 500,
      body: { error: 'Failed to fetch household preferences' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/households/me/preferences',
      userId: 'user-123',
    })
  })
})

describe('PATCH /api/households/me/preferences', () => {
  beforeEach(() => {
    mockUpdate.mockImplementation(
      async (_householdId, data) =>
        ({
          ...PREFERENCES,
          ...data,
        }) as never,
    )
    mockCountConflicts.mockResolvedValue(2)
  })

  it('answers 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(patch({ restrictions: [] }))).toEqual({
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
    ['an unknown dietary type', { dietaryType: 'carnivore' }, 'dietaryType'],
    ['an unknown allergen', { allergensToAvoid: ['pollen'] }, 'allergensToAvoid'],
    ['an unknown meal type', { weekdayMealTypes: ['brunch'] }, 'weekdayMealTypes'],
    ['no weekday meal type', { weekdayMealTypes: [] }, 'weekdayMealTypes'],
    ['no weekend meal type', { weekendMealTypes: [] }, 'weekendMealTypes'],
  ])('answers 400 for %s', async (_label, body, field) => {
    const { status, body: answered } = await answer(patch(body))

    expect(status).toBe(400)
    expect(answered.error).toBe('Validation failed')
    expect(Object.keys(answered.details)).toEqual([field])
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('answers 404 when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(patch({ restrictions: [] }))).toEqual({
      status: 404,
      body: { error: 'No household found' },
    })
  })

  it('answers 403 to a member who is not the owner, and saves nothing', async () => {
    mockGetMembership.mockResolvedValue(membership({ role: 'member' }))

    expect(await answer(patch({ restrictions: [] }))).toEqual({
      status: 403,
      body: { error: 'Only household owners can update preferences' },
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("saves the validated fields on the user's household", async () => {
    await patch({ dietaryType: null, restrictions: ['low-salt'], unknown: 'dropped' })

    expect(mockUpdate).toHaveBeenCalledWith('household-123', {
      dietaryType: null,
      restrictions: ['low-salt'],
    })
  })

  // A household with no preferences row saves too: the lib upserts (HON-672).
  it('saves for a household that has no preferences row', async () => {
    mockGetMembership.mockResolvedValue(membership({ preferences: null }))

    expect((await answer(patch({ weekdayMealTypes: ['lunch'] }))).status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith('household-123', { weekdayMealTypes: ['lunch'] })
  })

  it.each([
    ['dietary type', { dietaryType: 'vegan' }],
    ['allergens', { allergensToAvoid: ['nuts'] }],
    ['excluded ingredients', { excludedIngredients: ['cilantro'] }],
  ])(
    'answers a %s save with the count of planned meals that now break it',
    async (_label, body) => {
      expect(await answer(patch(body))).toEqual({
        status: 200,
        body: {
          ...PREFERENCES,
          ...body,
          excludedMatches: matchesFor(
            'excludedIngredients' in body ? body.excludedIngredients : [],
          ),
          conflictingEntries: 2,
        },
      })
      const [household, saved] = mockCountConflicts.mock.calls[0]!
      expect(household).toMatchObject({ id: 'household-123', timezone: 'Europe/Tallinn' })
      expect(saved).toMatchObject(body)
    },
  )

  // HON-1321: the form shows what each tag matched, so a household sees a
  // tag that excludes nothing.
  it('answers what each tag matches on GET and PATCH', async () => {
    mockGetMembership.mockResolvedValue(
      membership({ preferences: { ...PREFERENCES, excludedIngredients: ['seened'] } }),
    )
    expect((await answer(GET())).body.excludedMatches).toEqual(matchesFor(['seened']))
    expect(mockMatchExcluded).toHaveBeenLastCalledWith('household-123', ['seened'])

    const saved = await answer(patch({ excludedIngredients: ['mushrooms', 'dragonfruit'] }))
    expect(saved.body.excludedMatches).toEqual(matchesFor(['mushrooms', 'dragonfruit']))
    expect(mockMatchExcluded).toHaveBeenLastCalledWith('household-123', [
      'mushrooms',
      'dragonfruit',
    ])
  })

  it('does not count conflicts after a meal-types save', async () => {
    expect(await answer(patch({ weekendMealTypes: ['lunch', 'dinner'] }))).toEqual({
      status: 200,
      body: { ...PREFERENCES, weekendMealTypes: ['lunch', 'dinner'], excludedMatches: [] },
    })
    expect(mockCountConflicts).not.toHaveBeenCalled()
  })

  // The preferences are stored by then, so the save still succeeds (HON-1126).
  it('still answers the save, without a count, and reports it when the count fails', async () => {
    const failure = new Error('count failed')
    mockCountConflicts.mockRejectedValue(failure)

    expect(await answer(patch({ dietaryType: 'vegan' }))).toEqual({
      status: 200,
      body: { ...PREFERENCES, dietaryType: 'vegan', excludedMatches: [] },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/households/me/preferences',
      userId: 'user-123',
      householdId: 'household-123',
    })
  })

  it('answers 500 and reports a failed save', async () => {
    const failure = new Error('database down')
    mockUpdate.mockRejectedValue(failure)

    expect(await answer(patch({ restrictions: [] }))).toEqual({
      status: 500,
      body: { error: 'Failed to update household preferences' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/households/me/preferences',
      userId: 'user-123',
    })
  })
})
