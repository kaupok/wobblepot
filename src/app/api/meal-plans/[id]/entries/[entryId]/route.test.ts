import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PATCH, DELETE } from './route'

// The entry rules and every query live in `@/lib/meal-plans/entries`, tested
// against a database in `entries.db.test.ts`. This file mocks that module at
// the seam and asserts what the route owns: the session, the household, body
// validation, and the status and body each answer maps to (HON-1189).

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

vi.mock('@/lib/meal-plans/entries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/entries')>()),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import {
  deleteEntry,
  EntryUpdateError,
  updateEntry,
  type EntryUpdateRefusal,
} from '@/lib/meal-plans/entries'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockUpdateEntry = vi.mocked(updateEntry)
const mockDeleteEntry = vi.mocked(deleteEntry)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: { id: 'household-123', name: 'Test', timezone: 'Europe/Tallinn' },
} as never

const URL = 'http://localhost/api/meal-plans/plan-123/entries/entry-123'
const params = () => Promise.resolve({ id: 'plan-123', entryId: 'entry-123' })

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
  mockGetMembership.mockResolvedValue(mockMembership)
})

describe('PATCH /api/meal-plans/[id]/entries/[entryId]', () => {
  it('answers 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(patch({ status: 'completed' }))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    })
  })

  it('answers 404 without a household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(patch({ status: 'completed' }))).toEqual({
      status: 404,
      body: { error: 'No household found' },
    })
  })

  it('answers 400 for a body that is not JSON', async () => {
    expect(await answer(patch('{not json'))).toEqual({
      status: 400,
      body: { error: 'Invalid JSON' },
    })
  })

  it.each([
    ['an unknown status', { status: 'eaten' }],
    ['an unknown rating', { rating: 'meh' }],
    ['a count below 1', { servingOverride: 0 }],
    ['a count above 20', { servingOverride: 21 }],
    ['a fractional count', { servingOverride: 1.5 }],
    ['a note over 200 characters', { note: 'x'.repeat(201) }],
    ['one axis of the note place', { noteX: 0.5 }],
    ['an axis outside 0 to 1', { noteX: 1.5, noteY: 0.5 }],
    ['one axis null and one set', { noteX: null, noteY: 0.5 }],
    ['a place beside a cleared note', { note: null, noteX: 0.5, noteY: 0.5 }],
  ])('answers 400 for %s', async (_case, body) => {
    const { status, body: json } = await answer(patch(body))

    expect(status).toBe(400)
    expect(json.error).toBe('Validation failed')
  })

  it('hands the household, plan, entry and validated body to updateEntry', async () => {
    // Echoes its arguments, so the response shows what the route passed.
    mockUpdateEntry.mockImplementation(async (...args) => ({ args }) as never)

    const { status, body } = await answer(
      patch({ status: 'completed', deductPantry: true, servingOverride: 3, unknown: 'dropped' }),
    )

    expect(status).toBe(200)
    expect(body).toEqual({
      args: [
        'household-123',
        'plan-123',
        'entry-123',
        { status: 'completed', deductPantry: true, servingOverride: 3 },
      ],
    })
  })

  it('keeps a key sent as null, so updateEntry can tell a clear from an omission', async () => {
    mockUpdateEntry.mockImplementation(async (...args) => ({ patch: args[3] }) as never)

    const { body } = await answer(patch({ note: null, rating: null, servingOverride: null }))

    expect(body).toEqual({ patch: { note: null, rating: null, servingOverride: null } })
  })

  it('answers with the updated entry', async () => {
    mockUpdateEntry.mockResolvedValue({
      id: 'entry-123',
      status: 'completed',
      mealId: 'meal-123',
      rating: null,
      pantryDeducted: true,
    })

    expect(await answer(patch({ status: 'completed', deductPantry: true }))).toEqual({
      status: 200,
      body: {
        id: 'entry-123',
        status: 'completed',
        mealId: 'meal-123',
        rating: null,
        pantryDeducted: true,
      },
    })
  })

  it.each<[EntryUpdateRefusal, number, string]>([
    ['entryNotFound', 404, 'Entry not found or access denied'],
    ['mealNotFound', 404, 'Meal not found'],
    ['noFields', 400, 'No fields to update'],
    ['completedSwap', 409, 'Cannot swap a completed meal'],
    ['completedServings', 409, 'Cannot change servings on a completed meal'],
    ['staleMeal', 409, 'The meal changed while completing. Try again.'],
    ['noNote', 409, 'Entry has no note'],
  ])('answers the %s refusal with %i, and does not report it', async (reason, status, error) => {
    mockUpdateEntry.mockRejectedValue(new EntryUpdateError(reason))

    expect(await answer(patch({ mealId: 'meal-456' }))).toEqual({ status, body: { error } })
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('answers 500 for an unexpected failure, and reports it', async () => {
    const failure = new Error('connection reset')
    mockUpdateEntry.mockRejectedValue(failure)

    expect(await answer(patch({ status: 'completed' }))).toEqual({
      status: 500,
      body: { error: 'Failed to update entry status' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/meal-plans/[id]/entries/[entryId]',
      userId: 'user-123',
    })
  })
})

describe('DELETE /api/meal-plans/[id]/entries/[entryId]', () => {
  it('answers 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(del())).toEqual({ status: 401, body: { error: 'Unauthorized' } })
  })

  it('answers 404 without a household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(del())).toEqual({ status: 404, body: { error: 'No household found' } })
  })

  it("deletes the entry from the user's household", async () => {
    mockDeleteEntry.mockImplementation(
      async (householdId, planId, entryId) =>
        householdId === 'household-123' && planId === 'plan-123' && entryId === 'entry-123',
    )

    expect(await answer(del())).toEqual({ status: 200, body: { success: true } })
  })

  it('answers 404 when the household has no such entry', async () => {
    mockDeleteEntry.mockResolvedValue(false)

    expect(await answer(del())).toEqual({
      status: 404,
      body: { error: 'Entry not found or access denied' },
    })
  })

  it('answers 500 for an unexpected failure, and reports it', async () => {
    const failure = new Error('connection reset')
    mockDeleteEntry.mockRejectedValue(failure)

    expect(await answer(del())).toEqual({ status: 500, body: { error: 'Failed to delete entry' } })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/meal-plans/[id]/entries/[entryId]',
      userId: 'user-123',
    })
  })
})
