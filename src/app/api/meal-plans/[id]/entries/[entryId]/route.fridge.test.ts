import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PATCH } from './route'

// The fridge-meal fields of the entry PATCH (HON-1277). The persistence is
// `@/lib/meal-plans/fridge-meal` and `updateEntry`, tested against a database
// in `fridge-meal.db.test.ts`; this file asserts the validation and the
// answers the route maps.

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

vi.mock('@/lib/meal-plans/discard-placeholder', () => ({
  discardPlaceholder: vi.fn(),
}))

vi.mock('@/lib/meal-plans/entries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/entries')>()),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
}))

vi.mock('@/lib/meal-plans/fridge-meal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/fridge-meal')>()),
  setFridgeItems: vi.fn(),
}))

// The source rule is tested against a database in `plan-fridge-meal.leftovers.db.test.ts`.
vi.mock('@/lib/meal-plans/recent-meals', () => ({
  findLeftoverProblemForEntry: vi.fn(() => Promise.resolve(null)),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { updateEntry } from '@/lib/meal-plans/entries'
import {
  FridgeItemNotFoundError,
  setFridgeItems,
  SetFridgeItemsError,
} from '@/lib/meal-plans/fridge-meal'
import { findLeftoverProblemForEntry } from '@/lib/meal-plans/recent-meals'

const mockUpdateEntry = vi.mocked(updateEntry)
const mockSetFridgeItems = vi.mocked(setFridgeItems)

const URL = 'http://localhost/api/meal-plans/plan-123/entries/entry-123'

async function patch(body: unknown) {
  const res = await PATCH(new Request(URL, { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'plan-123', entryId: 'entry-123' }),
  })
  return { status: res.status, body: await res.json() }
}

const ITEMS = [
  { ingredientId: 'ing-cucumber' },
  { sourceEntryId: 'entry-mash' },
  { label: 'meatballs' },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: 'user-123' } } as never)
  vi.mocked(getHouseholdMembership).mockResolvedValue({
    household: { id: 'household-123' },
  } as never)
})

describe('PATCH with fridgeItems', () => {
  it('writes the items through setFridgeItems, and not updateEntry', async () => {
    const updated = { id: 'entry-123', status: 'planned' as const, mealId: null, rating: null }
    mockSetFridgeItems.mockResolvedValue(updated)

    expect(await patch({ fridgeItems: ITEMS })).toEqual({ status: 200, body: updated })
    expect(mockSetFridgeItems).toHaveBeenCalledWith('household-123', 'plan-123', 'entry-123', ITEMS)
    expect(mockUpdateEntry).not.toHaveBeenCalled()
  })

  it('answers 400 with the code when the source rule refuses an item (HON-1396)', async () => {
    vi.mocked(findLeftoverProblemForEntry).mockResolvedValueOnce({
      sourceEntryId: 'entry-mash',
      problem: 'tooOld',
    })

    expect(await patch({ fridgeItems: ITEMS })).toEqual({
      status: 400,
      body: {
        error: 'Leftover source refused',
        code: 'leftover_source',
        sourceEntryId: 'entry-mash',
        problem: 'tooOld',
      },
    })
    expect(findLeftoverProblemForEntry).toHaveBeenCalledWith('household-123', 'entry-123', ITEMS)
    expect(mockSetFridgeItems).not.toHaveBeenCalled()
  })

  it('answers 400 for items sent with another field', async () => {
    expect((await patch({ fridgeItems: ITEMS, status: 'completed' })).status).toBe(400)
    expect(mockSetFridgeItems).not.toHaveBeenCalled()
  })

  it.each([
    ['no items', []],
    ['an item with two sources', [{ ingredientId: 'a', label: 'b' }]],
    ['an empty label', [{ label: '  ' }]],
    ['a label over 80 characters', [{ label: 'x'.repeat(81) }]],
    ['the same dinner twice', [{ sourceEntryId: 'e1' }, { sourceEntryId: 'e1' }]],
  ])('answers 400 for %s', async (_, fridgeItems) => {
    expect((await patch({ fridgeItems })).status).toBe(400)
  })

  it('answers 409 for a completed entry', async () => {
    mockSetFridgeItems.mockRejectedValue(new SetFridgeItemsError('completed'))

    expect(await patch({ fridgeItems: ITEMS })).toEqual({
      status: 409,
      body: { error: 'Cannot change a completed meal' },
    })
  })

  it('answers 404 for a missing entry or an item the household may not see', async () => {
    mockSetFridgeItems.mockRejectedValueOnce(new SetFridgeItemsError('entryNotFound'))
    expect((await patch({ fridgeItems: ITEMS })).status).toBe(404)

    mockSetFridgeItems.mockRejectedValueOnce(new FridgeItemNotFoundError())
    expect(await patch({ fridgeItems: ITEMS })).toEqual({
      status: 404,
      body: { error: 'Fridge meal item not found' },
    })
  })
})

describe('PATCH with usedUpIngredientIds', () => {
  it('hands the used-up ids to updateEntry with the completion', async () => {
    mockUpdateEntry.mockResolvedValue({
      id: 'entry-123',
      status: 'completed',
      mealId: null,
      rating: undefined,
      pantryDeducted: true,
    })

    const { status } = await patch({ status: 'completed', usedUpIngredientIds: ['ing-cucumber'] })

    expect(status).toBe(200)
    expect(mockUpdateEntry).toHaveBeenCalledWith('household-123', 'plan-123', 'entry-123', {
      status: 'completed',
      usedUpIngredientIds: ['ing-cucumber'],
    })
  })

  it.each([
    ['without a completion', { usedUpIngredientIds: ['a'] }],
    ['with a revert', { status: 'planned', usedUpIngredientIds: ['a'] }],
    ['with a swap', { status: 'completed', mealId: 'meal-1', usedUpIngredientIds: ['a'] }],
  ])('answers 400 %s', async (_, body) => {
    expect((await patch(body)).status).toBe(400)
    expect(mockUpdateEntry).not.toHaveBeenCalled()
  })
})
