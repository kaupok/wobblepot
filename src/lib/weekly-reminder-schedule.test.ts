import { describe, expect, it } from 'vitest'

import { toDateString } from '@/lib/meal-planning/dates'

import { isoWeekday, nextWeekRange, toReminderWeekday } from './weekly-reminder-schedule'

describe('isoWeekday', () => {
  it('numbers Monday 1 and Sunday 7', () => {
    expect(isoWeekday('2026-10-05')).toBe(1) // Monday
    expect(isoWeekday('2026-10-07')).toBe(3) // Wednesday
    expect(isoWeekday('2026-10-11')).toBe(7) // Sunday
  })
})

describe('nextWeekRange', () => {
  const range = (today: string) => {
    const { start, end } = nextWeekRange(today)
    return [toDateString(start), toDateString(end)]
  }

  it('starts tomorrow on a Sunday', () => {
    expect(range('2026-10-11')).toEqual(['2026-10-12', '2026-10-19'])
  })

  it('starts in seven days on a Monday', () => {
    expect(range('2026-10-05')).toEqual(['2026-10-12', '2026-10-19'])
  })

  it('starts on the coming Monday mid-week', () => {
    expect(range('2026-10-07')).toEqual(['2026-10-12', '2026-10-19'])
  })

  it('crosses a month and a year', () => {
    expect(range('2026-12-30')).toEqual(['2027-01-04', '2027-01-11'])
  })
})

describe('toReminderWeekday', () => {
  it.each([1, 4, 7])('keeps the stored weekday %i', (value) => {
    expect(toReminderWeekday(value)).toBe(value)
  })

  it.each([null, 0, 8, -1, 2.5])('reads %s as off', (value) => {
    expect(toReminderWeekday(value)).toBeNull()
  })
})
