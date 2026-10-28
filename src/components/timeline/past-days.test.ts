import { describe, it, expect } from 'vitest'
import { buildPastDays } from './past-days'
import { createExpectedMealTypes, createMeal, createPlanEntry } from '@/stories/fixtures'

// A Wednesday. The 11th and 12th are the weekend before it.
const today = '2026-04-15'
const dinnerOnly = createExpectedMealTypes()

const build = (
  entries: Parameters<typeof buildPastDays>[0],
  overrides: Partial<Parameters<typeof buildPastDays>[1]> = {},
) =>
  buildPastDays(entries, {
    startDate: '2026-04-08',
    todayDate: today,
    expectedMealTypes: dinnerOnly,
    locale: 'en',
    ...overrides,
  })

describe('buildPastDays', () => {
  it('returns every past day in the range, newest first, today left out', () => {
    const days = build([createPlanEntry({ id: 'today', date: today })])

    expect(days.map((d) => d.date)).toEqual([
      '2026-04-14',
      '2026-04-13',
      '2026-04-12',
      '2026-04-11',
      '2026-04-10',
      '2026-04-09',
      '2026-04-08',
    ])
    expect(days.every((d) => !d.isToday && !d.isTomorrow)).toBe(true)
    expect(days.flatMap((d) => d.entries)).toEqual([])
  })

  it('shows a day with no entries as its empty dinner slot', () => {
    const [yesterday] = build([])

    expect(yesterday?.date).toBe('2026-04-14')
    expect(yesterday?.entries).toEqual([])
    expect(yesterday?.emptySlots).toEqual(['dinner'])
  })

  it('takes weekday and weekend meal types from the day', () => {
    const days = build([], {
      expectedMealTypes: createExpectedMealTypes({
        weekdayMealTypes: ['dinner'],
        weekendMealTypes: ['breakfast', 'lunch', 'dinner'],
      }),
    })
    const slotsOn = (date: string) => days.find((d) => d.date === date)?.emptySlots

    expect(slotsOn('2026-04-14')).toEqual(['dinner'])
    expect(slotsOn('2026-04-12')).toEqual(['breakfast', 'lunch', 'dinner'])
    expect(slotsOn('2026-04-11')).toEqual(['breakfast', 'lunch', 'dinner'])
    expect(slotsOn('2026-04-10')).toEqual(['dinner'])
  })

  it('gives a dinner-only household no breakfast or lunch slots', () => {
    const days = build([])

    expect(new Set(days.flatMap((d) => d.emptySlots))).toEqual(new Set(['dinner']))
  })

  it('leaves out a day whose slots are all filled by an entry', () => {
    const days = build([createPlanEntry({ id: 'eaten', date: '2026-04-14', status: 'completed' })])

    expect(days[0]?.entries.map((e) => e.id)).toEqual(['eaten'])
    expect(days[0]?.emptySlots).toEqual([])
  })

  it('keeps fridge meals as rows', () => {
    const fridge = createPlanEntry({ id: 'fridge', date: '2026-04-13', meal: null, kind: 'fridge' })

    const day = build([fridge]).find((d) => d.date === '2026-04-13')

    expect(day?.entries.map((e) => e.id)).toEqual(['fridge'])
    expect(day?.emptySlots).toEqual([])
  })

  it('treats a note-only slot as taken but shows it as no row', () => {
    const note = createPlanEntry({ id: 'note', date: '2026-04-14', meal: null, note: 'Out' })

    expect(build([note]).map((d) => d.date)).not.toContain('2026-04-14')
  })

  it('treats a leftover picker placeholder as an empty slot', () => {
    const placeholder = createPlanEntry({ id: 'p', date: '2026-04-14', meal: null })

    const [yesterday] = build([placeholder])

    expect(yesterday?.entries).toEqual([])
    expect(yesterday?.emptySlots).toEqual(['dinner'])
  })

  it('reaches back as far as the start date', () => {
    const days = build([], { startDate: '2026-04-01' })

    expect(days).toHaveLength(14)
    expect(days.at(-1)?.date).toBe('2026-04-01')
  })

  it('is empty when the range is', () => {
    expect(build([], { startDate: today })).toEqual([])
  })

  it('labels a day by its weekday, with the date beside it', () => {
    const [day] = build([])

    expect(day?.label).toBe('Tuesday')
    expect(day?.dateLabel).toBe('Apr 14')
  })

  it('orders one day’s entries breakfast, lunch, dinner', () => {
    const entries = [
      createPlanEntry({ id: 'dinner', date: '2026-04-14', mealType: 'dinner' }),
      createPlanEntry({ id: 'breakfast', date: '2026-04-14', mealType: 'breakfast' }),
      createPlanEntry({
        id: 'lunch',
        date: '2026-04-14',
        mealType: 'lunch',
        meal: createMeal({ id: 'm-lunch' }),
      }),
    ]

    const [day] = build(entries)

    expect(day?.entries.map((e) => e.id)).toEqual(['breakfast', 'lunch', 'dinner'])
  })
})
