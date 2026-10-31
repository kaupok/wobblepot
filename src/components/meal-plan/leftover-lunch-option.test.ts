import { describe, expect, it } from 'vitest'

import { getLeftoverLunchOptions } from './leftover-lunch-option'
import type { PlanEntry } from './types'

// "Cook for tomorrow's lunch too" on a dinner's menu (HON-1396). Wednesday the
// 21st's dinner feeds Thursday's lunch; Friday's would feed Saturday's.

const meal = { id: 'meal-stew', name: 'Stew' } as PlanEntry['meal']

function entry(id: string, date: string, data: Partial<PlanEntry> = {}): PlanEntry {
  return {
    id,
    date,
    mealType: 'dinner',
    status: 'planned',
    rating: null,
    meal,
    preparationTips: null,
    note: null,
    servingOverride: null,
    ...data,
  }
}

const dinner = entry('dinner', '2026-10-21')
const option = (entries: PlanEntry[]) => getLeftoverLunchOptions(entries).get('dinner')

describe('getLeftoverLunchOptions', () => {
  it("is available when tomorrow's lunch is empty, a fridge meal or a note-only card", () => {
    expect(option([dinner])).toEqual({ state: 'available' })
    expect(
      option([dinner, entry('l', '2026-10-22', { mealType: 'lunch', kind: 'fridge', meal: null })]),
    ).toEqual({ state: 'available' })
    expect(
      option([dinner, entry('l', '2026-10-22', { mealType: 'lunch', meal: null, note: 'Office' })]),
    ).toEqual({ state: 'available' })
  })

  it("says why when tomorrow's lunch is a recipe meal or cooked", () => {
    expect(option([dinner, entry('l', '2026-10-22', { mealType: 'lunch' })])).toEqual({
      state: 'unavailable',
      reason: 'recipeLunch',
    })
    expect(
      option([
        dinner,
        entry('l', '2026-10-22', {
          mealType: 'lunch',
          kind: 'fridge',
          meal: null,
          status: 'completed',
        }),
      ]),
    ).toEqual({ state: 'unavailable', reason: 'cooked' })
  })

  // Lunch need not be an expected meal type that day: every entry shows on
  // Today (HON-1518).
  it('is available on a Friday dinner, whatever meal types Saturday expects', () => {
    expect(option([entry('dinner', '2026-10-23')])).toEqual({ state: 'available' })
  })

  it('offers nothing when the lunch already takes leftovers from this dinner', () => {
    const linkedLunch = entry('l', '2026-10-22', {
      mealType: 'lunch',
      kind: 'fridge',
      meal: null,
      items: [
        {
          id: 'item-1',
          ingredientId: null,
          sourceEntryId: 'dinner',
          label: null,
          name: 'Stew',
          sourceDate: '2026-10-21',
          servings: null,
        },
      ],
    })
    expect(option([dinner, linkedLunch])).toBeUndefined()
    const withLeftovers = {
      ...dinner,
      leftoversFor: [{ date: '2026-10-22', mealType: 'lunch' as const, servings: 2.5 }],
    }
    expect(option([withLeftovers])).toBeUndefined()
  })

  it('offers nothing on a cooked, skipped or fridge-meal dinner, or on a lunch', () => {
    expect(option([{ ...dinner, status: 'completed' }])).toBeUndefined()
    expect(option([{ ...dinner, status: 'skipped' }])).toBeUndefined()
    expect(option([{ ...dinner, kind: 'fridge', meal: null }])).toBeUndefined()
    expect(option([{ ...dinner, mealType: 'lunch' }])).toBeUndefined()
  })
})
