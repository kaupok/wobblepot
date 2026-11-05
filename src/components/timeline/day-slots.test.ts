import { describe, expect, it } from 'vitest'

import { createExpectedMealTypes, createPlanEntry } from '@/stories/fixtures'

import { daySlots } from './day-slots'

// A Thursday and a Saturday.
const thursday = new Date(2026, 3, 16)
const saturday = new Date(2026, 3, 18)
const dinnerOnly = createExpectedMealTypes()

describe('daySlots otherSlots', () => {
  it("gives a dinner-only day's breakfast and lunch as the other types", () => {
    expect(daySlots(thursday, [], dinnerOnly)).toEqual({
      entries: [],
      emptySlots: ['dinner'],
      otherSlots: ['breakfast', 'lunch'],
      hasExpectedEntry: false,
    })
  })

  it('leaves out a type with an entry, whether expected or not', () => {
    const breakfast = createPlanEntry({ id: 'b', date: '2026-04-16', mealType: 'breakfast' })
    const dinner = createPlanEntry({ id: 'd', date: '2026-04-16', mealType: 'dinner' })

    const slots = daySlots(thursday, [dinner, breakfast], dinnerOnly)

    expect(slots.emptySlots).toEqual([])
    expect(slots.otherSlots).toEqual(['lunch'])
  })

  it('leaves out the expected types, by weekday or weekend', () => {
    const expected = createExpectedMealTypes({
      weekdayMealTypes: ['dinner'],
      weekendMealTypes: ['breakfast', 'dinner'],
    })

    expect(daySlots(saturday, [], expected).otherSlots).toEqual(['lunch'])
    expect(daySlots(thursday, [], expected).otherSlots).toEqual(['breakfast', 'lunch'])
  })

  it('counts a picker placeholder as no entry', () => {
    const placeholder = createPlanEntry({ id: 'p', mealType: 'lunch', meal: null })

    expect(daySlots(thursday, [placeholder], dinnerOnly).otherSlots).toEqual(['breakfast', 'lunch'])
  })

  it('is empty when every type has an entry', () => {
    const entries = (['breakfast', 'lunch', 'dinner'] as const).map((mealType) =>
      createPlanEntry({ id: mealType, mealType }),
    )

    expect(daySlots(thursday, entries, dinnerOnly)).toMatchObject({
      emptySlots: [],
      otherSlots: [],
    })
  })
})

describe('daySlots hasExpectedEntry', () => {
  it('is false when the only entry is an off-type one', () => {
    const breakfast = createPlanEntry({ id: 'b', date: '2026-04-18', mealType: 'breakfast' })

    expect(daySlots(saturday, [breakfast], dinnerOnly).hasExpectedEntry).toBe(false)
  })

  it('is true when an entry fills an expected slot', () => {
    const dinner = createPlanEntry({ id: 'd', date: '2026-04-18', mealType: 'dinner' })

    expect(daySlots(saturday, [dinner], dinnerOnly).hasExpectedEntry).toBe(true)
  })
})
