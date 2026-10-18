import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PUT } from './route'

// The rules live in `replaceEntryChanges`, tested against a database in
// `entry-changes.replace.db.test.ts`. This file asserts what the PUT owns: the
// session, the body, and the status each answer maps to (HON-1244).

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
  replaceEntryChanges: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { EntryChangeError, replaceEntryChanges } from '@/lib/meal-plans/entry-changes'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockReplace = vi.mocked(replaceEntryChanges)

const URL = 'http://localhost/api/meal-plans/plan-1/entries/entry-1/components'
const params = { params: Promise.resolve({ id: 'plan-1', entryId: 'entry-1' }) }

const put = (body: unknown) =>
  PUT(
    new Request(URL, {
      method: 'PUT',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    params,
  )

const yoghurt = {
  originalIngredientId: 'cream',
  replacementIngredientId: 'yoghurt',
  quantityPerServing: 60,
}

describe('PUT /api/meal-plans/[id]/entries/[entryId]/components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockGetMembership.mockResolvedValue({ household: { id: 'household-1' } } as never)
  })

  it('replaces the set with the trimmed instruction and returns the merge', async () => {
    mockReplace.mockResolvedValue({ components: [] } as never)

    const response = await put({ changes: [yoghurt], adjustmentNote: '  No cream  ' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ components: [] })
    expect(mockReplace).toHaveBeenCalledWith('household-1', 'plan-1', 'entry-1', {
      changes: [yoghurt],
      adjustmentNote: 'No cream',
    })
  })

  it('reads a blank instruction as none', async () => {
    mockReplace.mockResolvedValue({ components: [] } as never)

    await put({ changes: [], adjustmentNote: '   ' })

    expect(mockReplace).toHaveBeenCalledWith('household-1', 'plan-1', 'entry-1', {
      changes: [],
      adjustmentNote: null,
    })
  })

  it.each([
    ['a change the POST would refuse', { changes: [{ ...yoghurt, quantityPerServing: null }] }],
    ['an instruction over 500 characters', { changes: [], adjustmentNote: 'x'.repeat(501) }],
    ['no change list', { adjustmentNote: 'No cream' }],
  ])('answers 400 for %s', async (_label, body) => {
    const response = await put(body)

    expect(response.status).toBe(400)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('answers 400 for a body that is not JSON', async () => {
    expect((await put('{')).status).toBe(400)
  })

  it.each([
    ['notPlanned', 409],
    ['alreadyChanged', 409],
    ['alreadyInMeal', 409],
    ['originalNotInMeal', 400],
    ['entryNotFound', 404],
  ] as const)('maps %s to %i with its code', async (reason, status) => {
    mockReplace.mockRejectedValue(new EntryChangeError(reason))

    const response = await put({ changes: [yoghurt], adjustmentNote: 'No cream' })

    expect(response.status).toBe(status)
    expect((await response.json()).code).toBe(reason)
  })

  it('answers 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null as never)

    expect((await put({ changes: [] })).status).toBe(401)
  })
})
