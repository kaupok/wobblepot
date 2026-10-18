import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

// Every rule and query lives in `@/lib/meal-plans/entry-changes`, tested
// against a database in `entry-changes.db.test.ts`. This file mocks that
// module and asserts what the route owns: the session, the household, the
// body, and the status each answer maps to (HON-1243).

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

vi.mock('@/lib/meal-plans/entry-changes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/entry-changes')>()),
  addEntryChange: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import {
  addEntryChange,
  EntryChangeError,
  type EntryChangeRefusal,
} from '@/lib/meal-plans/entry-changes'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockAdd = vi.mocked(addEntryChange)

const URL = 'http://localhost/api/meal-plans/plan-1/entries/entry-1/components'
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

describe('POST /api/meal-plans/[id]/entries/[entryId]/components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockGetMembership.mockResolvedValue({ household: { id: 'household-1' } } as never)
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)
    expect((await post({ originalIngredientId: 'a' })).status).toBe(401)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('returns 404 without a household', async () => {
    mockGetMembership.mockResolvedValue(null)
    expect((await post({ originalIngredientId: 'a' })).status).toBe(404)
  })

  it('returns 400 on invalid JSON', async () => {
    expect((await post('{nope')).status).toBe(400)
  })

  it.each([
    ['both ids missing', {}],
    ['both ids null', { originalIngredientId: null, replacementIngredientId: null }],
    [
      'a replacement without a quantity',
      { originalIngredientId: 'a', replacementIngredientId: 'b' },
    ],
    ['an add without a quantity', { replacementIngredientId: 'b' }],
    ['a leave-out with a quantity', { originalIngredientId: 'a', quantityPerServing: 10 }],
    ['a zero quantity', { replacementIngredientId: 'b', quantityPerServing: 0 }],
    ['a quantity above the bound', { replacementIngredientId: 'b', quantityPerServing: 5001 }],
    [
      'the original as its own replacement',
      { originalIngredientId: 'a', replacementIngredientId: 'a', quantityPerServing: 10 },
    ],
  ])('returns 400 on %s', async (_name, body) => {
    const response = await post(body)
    expect(response.status).toBe(400)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('passes a replace to the lib for the household and returns 201 with its answer', async () => {
    const answer = { change: { id: 'c1' }, components: [] }
    mockAdd.mockResolvedValue(answer as never)

    const response = await post({
      originalIngredientId: 'cream',
      replacementIngredientId: 'yoghurt',
      quantityPerServing: 60,
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(answer)
    expect(mockAdd).toHaveBeenCalledWith('household-1', 'plan-1', 'entry-1', {
      originalIngredientId: 'cream',
      replacementIngredientId: 'yoghurt',
      quantityPerServing: 60,
    })
  })

  it('normalises a leave-out to null replacement and quantity', async () => {
    mockAdd.mockResolvedValue({ change: { id: 'c1' }, components: [] } as never)
    await post({ originalIngredientId: 'mushroom' })
    expect(mockAdd).toHaveBeenCalledWith('household-1', 'plan-1', 'entry-1', {
      originalIngredientId: 'mushroom',
      replacementIngredientId: null,
      quantityPerServing: null,
    })
  })

  it.each<[EntryChangeRefusal, number]>([
    ['entryNotFound', 404],
    ['ingredientNotFound', 404],
    ['notPlanned', 409],
    ['originalNotInMeal', 400],
    ['alreadyChanged', 409],
    ['alreadyInMeal', 409],
  ])('maps %s to %i with its code', async (reason, status) => {
    mockAdd.mockRejectedValue(new EntryChangeError(reason))
    const response = await post({ originalIngredientId: 'a' })
    expect(response.status).toBe(status)
    expect((await response.json()).code).toBe(reason)
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it('reports an unexpected failure and returns 500', async () => {
    mockAdd.mockRejectedValue(new Error('boom'))
    expect((await post({ originalIngredientId: 'a' })).status).toBe(500)
    expect(captureApiError).toHaveBeenCalledTimes(1)
  })
})
