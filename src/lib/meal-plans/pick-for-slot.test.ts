import { beforeEach, describe, expect, it, vi } from 'vitest'

// The ranking and the write are tested where they live (slot-suggestions,
// `entries.db.test.ts`); this file asserts how "Pick for me" joins them.

vi.mock('@/lib/meal-planning/slot-suggestions', () => ({
  suggestForSlot: vi.fn(),
}))

vi.mock('@/lib/meal-plans/create-entry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/create-entry')>()),
  createEntry: vi.fn(),
}))

import type { AlternativeMeal } from '@/components/meal-plan/types'
import { suggestForSlot } from '@/lib/meal-planning/slot-suggestions'
import { createEntry, EntryCreateError } from '@/lib/meal-plans/create-entry'

import { NoSuggestionsError, pickMealForSlot } from './pick-for-slot'

const mockSuggestForSlot = vi.mocked(suggestForSlot)
const mockCreateEntry = vi.mocked(createEntry)

const household = {
  id: 'household-1',
  preferences: { dietaryType: null, allergensToAvoid: [], excludedIngredients: [] },
}
const slot = { date: '2099-01-28', mealType: 'dinner' } as const

const suggestion = (id: string, name: string) => ({ id, name }) as AlternativeMeal

const created = {
  id: 'entry-1',
  date: '2099-01-28',
  mealType: 'dinner',
  status: 'planned',
  mealId: 'meal-top',
  note: null,
} as const

beforeEach(() => {
  mockCreateEntry.mockResolvedValue(created)
})

describe('pickMealForSlot', () => {
  it('ranks the slot in add mode with a stand-in entry keyed by the slot', async () => {
    mockSuggestForSlot.mockResolvedValue([suggestion('meal-top', 'Fish pie')])

    await pickMealForSlot(household, 'plan-1', slot, 'et')

    expect(mockSuggestForSlot).toHaveBeenCalledWith(
      household,
      { id: '2099-01-28:dinner', mealType: 'dinner', mealId: null },
      'add',
      'et',
    )
  })

  it('creates the entry with the top suggestion and returns its name', async () => {
    mockSuggestForSlot.mockResolvedValue([
      suggestion('meal-top', 'Fish pie'),
      suggestion('meal-2', 'Lentil soup'),
    ])

    const result = await pickMealForSlot(household, 'plan-1', slot, 'en')

    expect(mockCreateEntry).toHaveBeenCalledWith('household-1', 'plan-1', {
      date: new Date(2099, 0, 28),
      mealType: 'dinner',
      mealId: 'meal-top',
    })
    expect(result).toEqual({ ...created, mealName: 'Fish pie' })
  })

  it('throws NoSuggestionsError and writes nothing when no meal fits', async () => {
    mockSuggestForSlot.mockResolvedValue([])

    await expect(pickMealForSlot(household, 'plan-1', slot, 'en')).rejects.toBeInstanceOf(
      NoSuggestionsError,
    )
    expect(mockCreateEntry).not.toHaveBeenCalled()
  })

  it("passes createEntry's refusal through", async () => {
    mockSuggestForSlot.mockResolvedValue([suggestion('meal-top', 'Fish pie')])
    mockCreateEntry.mockRejectedValue(new EntryCreateError('slotTaken'))

    await expect(pickMealForSlot(household, 'plan-1', slot, 'en')).rejects.toMatchObject({
      reason: 'slotTaken',
    })
  })
})
