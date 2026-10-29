import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from './route'

// The fridge-meal fields of the entry POST (HON-1277), and the leftover
// source rule it runs on them (HON-1396). The persistence is `createEntry`,
// tested against a database; the rule is tested in `recent-meals.db.test.ts`.
// This file asserts the validation and the answers the route maps.

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

vi.mock('@/lib/meal-plans/create-entry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/create-entry')>()),
  createEntry: vi.fn(),
}))

vi.mock('@/lib/meal-plans/recent-meals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/recent-meals')>()),
  findLeftoverSourceProblem: vi.fn(() => Promise.resolve(null)),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { createEntry } from '@/lib/meal-plans/create-entry'
import { FridgeItemNotFoundError } from '@/lib/meal-plans/fridge-meal'
import { findLeftoverSourceProblem } from '@/lib/meal-plans/recent-meals'

const mockCaptureApiError = vi.mocked(captureApiError)
const mockCreateEntry = vi.mocked(createEntry)

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/meal-plans/plan-123/entries', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'plan-123' }) },
  )

async function answer(response: Promise<Response>) {
  const res = await response
  return { status: res.status, body: await res.json() }
}

const created = {
  id: 'new-entry',
  date: '2099-01-28',
  mealType: 'dinner',
  status: 'planned',
  mealId: null,
  note: null,
} as const

beforeEach(() => {
  vi.clearAllMocks()
  // A test may make the source rule refuse; every other test passes it.
  vi.mocked(findLeftoverSourceProblem).mockResolvedValue(null)
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: 'user-123' } } as never)
  vi.mocked(getHouseholdMembership).mockResolvedValue({
    household: { id: 'household-123', timezone: 'Europe/Tallinn' },
  } as never)
})

describe('POST /api/meal-plans/[id]/entries', () => {
  describe('fridge meal (HON-1277)', () => {
    const fridgeItems = [{ ingredientId: 'ing-cucumber' }, { label: 'store meatballs' }]

    it('passes the items through to createEntry', async () => {
      mockCreateEntry.mockResolvedValue({ ...created, mealId: null })

      const { status } = await answer(post({ date: '2099-01-28', mealType: 'dinner', fridgeItems }))

      expect(status).toBe(200)
      expect(mockCreateEntry).toHaveBeenCalledWith('household-123', 'plan-123', {
        date: new Date(2099, 0, 28),
        mealType: 'dinner',
        fridgeItems,
      })
    })

    it.each([
      ['with a meal', { mealId: 'meal-1' }],
      ['with a pick', { pick: 'suggested' }],
    ])('refuses items %s', async (_label, extra) => {
      const body = { date: '2099-01-28', mealType: 'dinner', fridgeItems, ...extra }

      expect((await answer(post(body))).status).toBe(400)
      expect(mockCreateEntry).not.toHaveBeenCalled()
    })

    it('runs the source rule for the slot, and answers 400 with its code when it refuses (HON-1396)', async () => {
      const leftovers = [{ sourceEntryId: 'entry-dinner' }]
      vi.mocked(findLeftoverSourceProblem).mockResolvedValueOnce({
        sourceEntryId: 'entry-dinner',
        problem: 'servingsRequired',
      })

      expect(
        await answer(post({ date: '2099-01-28', mealType: 'lunch', fridgeItems: leftovers })),
      ).toEqual({
        status: 400,
        body: {
          error: 'Leftover source refused',
          code: 'leftover_source',
          sourceEntryId: 'entry-dinner',
          problem: 'servingsRequired',
        },
      })
      expect(findLeftoverSourceProblem).toHaveBeenCalledWith(
        'household-123',
        { date: '2099-01-28', mealType: 'lunch' },
        leftovers,
        undefined,
      )
      expect(mockCreateEntry).not.toHaveBeenCalled()
    })

    // A new fridge meal with a source older than the window is refused; only
    // a restore passes it (HON-1451).
    it('refuses a new fridge meal whose source is too old', async () => {
      const leftovers = [{ sourceEntryId: 'entry-dinner' }]
      vi.mocked(findLeftoverSourceProblem).mockResolvedValueOnce({
        sourceEntryId: 'entry-dinner',
        problem: 'tooOld',
      })

      expect(
        await answer(post({ date: '2099-01-28', mealType: 'lunch', fridgeItems: leftovers })),
      ).toEqual({
        status: 400,
        body: {
          error: 'Leftover source refused',
          code: 'leftover_source',
          sourceEntryId: 'entry-dinner',
          problem: 'tooOld',
        },
      })
      expect(findLeftoverSourceProblem).toHaveBeenCalledWith(
        'household-123',
        { date: '2099-01-28', mealType: 'lunch' },
        leftovers,
        undefined,
      )
      expect(mockCreateEntry).not.toHaveBeenCalled()
    })

    // Undo after Clear sends the entry's own items back. A source changed
    // since, such as a cooked dinner set back to planned with the item's
    // servings unset, or one the window moved past (HON-1451), must not
    // refuse it; a source the rule never allowed still does (HON-1396).
    it('runs the source rule on a restore, passing what a changed source causes', async () => {
      mockCreateEntry.mockResolvedValue({ ...created, mealId: null })
      const leftovers = [{ sourceEntryId: 'entry-dinner' }]

      const { status } = await answer(
        post({ date: '2099-01-28', mealType: 'lunch', fridgeItems: leftovers, restore: true }),
      )

      expect(status).toBe(200)
      expect(findLeftoverSourceProblem).toHaveBeenCalledWith(
        'household-123',
        { date: '2099-01-28', mealType: 'lunch' },
        leftovers,
        new Set(['skipped', 'notRecipe', 'servingsRequired', 'tooOld']),
      )
      // The flag is the route's, not an entry field.
      expect(mockCreateEntry).toHaveBeenCalledWith('household-123', 'plan-123', {
        date: new Date(2099, 0, 28),
        mealType: 'lunch',
        fridgeItems: leftovers,
      })
    })

    it('answers 404 for an item the household may not see, unreported', async () => {
      mockCreateEntry.mockRejectedValue(new FridgeItemNotFoundError())

      expect(await answer(post({ date: '2099-01-28', mealType: 'dinner', fridgeItems }))).toEqual({
        status: 404,
        body: { error: 'Fridge meal item not found' },
      })
      expect(mockCaptureApiError).not.toHaveBeenCalled()
    })
  })
})
