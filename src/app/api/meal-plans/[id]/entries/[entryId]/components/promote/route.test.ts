import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from './route'

// Every rule and query lives in `@/lib/meal-plans/promote-entry`, tested
// against a database in `promote-entry.db.test.ts`. This file mocks that
// module and asserts what the route owns: the session, the household, the
// body, and the status each answer maps to (HON-1245).

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

vi.mock('@/lib/meal-plans/promote-entry', () => ({
  promoteEntry: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { EntryChangeError, type EntryChangeRefusal } from '@/lib/meal-plans/entry-changes'
import { promoteEntry } from '@/lib/meal-plans/promote-entry'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockPromote = vi.mocked(promoteEntry)

const URL = 'http://localhost/api/meal-plans/plan-1/entries/entry-1/components/promote'
const params = { params: Promise.resolve({ id: 'plan-1', entryId: 'entry-1' }) }

function post(body: unknown) {
  return POST(
    new Request(URL, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    params,
  )
}

describe('POST /api/meal-plans/[id]/entries/[entryId]/components/promote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockGetMembership.mockResolvedValue({ household: { id: 'household-1' } } as never)
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)
    expect((await post({ name: 'Mine' })).status).toBe(401)
    expect(mockPromote).not.toHaveBeenCalled()
  })

  it('returns 404 without a household', async () => {
    mockGetMembership.mockResolvedValue(null)
    expect((await post({ name: 'Mine' })).status).toBe(404)
    expect(mockPromote).not.toHaveBeenCalled()
  })

  it('returns 400 on invalid JSON', async () => {
    expect((await post('{nope')).status).toBe(400)
  })

  it.each([
    ['no name', {}],
    ['a blank name', { name: '   ' }],
    ['a name over 200 characters', { name: 'a'.repeat(201) }],
    ['a name that is not a string', { name: 3 }],
  ])('returns 400 for %s', async (_, body) => {
    expect((await post(body)).status).toBe(400)
    expect(mockPromote).not.toHaveBeenCalled()
  })

  it('passes the trimmed name and answers the outcome', async () => {
    mockPromote.mockResolvedValue({ outcome: 'forked', mealId: 'meal-new' })

    const response = await post({ name: '  Pasta (my version) ' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ outcome: 'forked', mealId: 'meal-new' })
    expect(mockPromote).toHaveBeenCalledWith('household-1', 'plan-1', 'entry-1', {
      name: 'Pasta (my version)',
    })
  })

  it.each<[EntryChangeRefusal, number]>([
    ['entryNotFound', 404],
    ['notPlanned', 409],
    ['noChanges', 409],
    ['mealNotFound', 404],
    ['changesMoved', 409],
    ['invalidRecipe', 400],
    ['ingredientNotFound', 404],
  ])('maps %s to %i with its code', async (reason, status) => {
    mockPromote.mockRejectedValue(new EntryChangeError(reason))

    const response = await post({ name: 'Mine' })

    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ code: reason })
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it('returns 500 and reports an unexpected error', async () => {
    mockPromote.mockRejectedValue(new Error('boom'))

    const response = await post({ name: 'Mine' })

    expect(response.status).toBe(500)
    expect(captureApiError).toHaveBeenCalledOnce()
  })
})
