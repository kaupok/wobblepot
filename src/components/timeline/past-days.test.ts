import { describe, it, expect } from 'vitest'
import { buildPastDays } from './past-days'
import { createMeal, createPlanEntry } from '@/stories/fixtures'

const today = '2026-04-15'

describe('buildPastDays', () => {
  it('returns past days with entries, newest first', () => {
    const entries = [
      createPlanEntry({ id: 'a', date: '2026-04-12' }),
      createPlanEntry({ id: 'b', date: '2026-04-14' }),
      createPlanEntry({ id: 'c', date: '2026-04-13' }),
      createPlanEntry({ id: 'd', date: today }),
    ]

    const days = buildPastDays(entries, today, 'en')

    expect(days.map((d) => d.date)).toEqual(['2026-04-14', '2026-04-13', '2026-04-12'])
    expect(days.every((d) => !d.isToday && !d.isTomorrow)).toBe(true)
    expect(days.every((d) => d.emptySlots.length === 0)).toBe(true)
  })

  it('labels a day by its weekday, with the date beside it', () => {
    const [day] = buildPastDays([createPlanEntry({ date: '2026-04-14' })], today, 'en')

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

    const [day] = buildPastDays(entries, today, 'en')

    expect(day?.entries.map((e) => e.id)).toEqual(['breakfast', 'lunch', 'dinner'])
  })
})
