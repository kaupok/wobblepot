import { describe, it, expect } from 'vitest'
import { getStartDateOptions, getDaysCountOptions, computeEndDate } from './day-picker'

describe('getStartDateOptions', () => {
  it('returns 5 options starting from today', () => {
    const monday = new Date(2026, 1, 16) // Mon 16 Feb 2026
    const options = getStartDateOptions(monday)

    expect(options).toHaveLength(5)
  })

  it('returns Today, Tomorrow, then 3 named days for Monday (16 Feb)', () => {
    const monday = new Date(2026, 1, 16) // Mon 16 Feb 2026
    const options = getStartDateOptions(monday)

    expect(options).toEqual([
      { label: 'Today', date: '2026-02-16' },
      { label: 'Tomorrow', date: '2026-02-17' },
      { label: 'Wed (18 Feb)', date: '2026-02-18' },
      { label: 'Thu (19 Feb)', date: '2026-02-19' },
      { label: 'Fri (20 Feb)', date: '2026-02-20' },
    ])
  })

  it('returns correct options for Thursday (19 Feb)', () => {
    const thursday = new Date(2026, 1, 19) // Thu 19 Feb 2026
    const options = getStartDateOptions(thursday)

    expect(options).toEqual([
      { label: 'Today', date: '2026-02-19' },
      { label: 'Tomorrow', date: '2026-02-20' },
      { label: 'Sat (21 Feb)', date: '2026-02-21' },
      { label: 'Sun (22 Feb)', date: '2026-02-22' },
      { label: 'Mon (23 Feb)', date: '2026-02-23' },
    ])
  })

  it('returns correct options for Saturday (21 Feb)', () => {
    const saturday = new Date(2026, 1, 21) // Sat 21 Feb 2026
    const options = getStartDateOptions(saturday)

    expect(options).toEqual([
      { label: 'Today', date: '2026-02-21' },
      { label: 'Tomorrow', date: '2026-02-22' },
      { label: 'Mon (23 Feb)', date: '2026-02-23' },
      { label: 'Tue (24 Feb)', date: '2026-02-24' },
      { label: 'Wed (25 Feb)', date: '2026-02-25' },
    ])
  })

  it('returns correct options for Sunday (22 Feb)', () => {
    const sunday = new Date(2026, 1, 22) // Sun 22 Feb 2026
    const options = getStartDateOptions(sunday)

    expect(options).toEqual([
      { label: 'Today', date: '2026-02-22' },
      { label: 'Tomorrow', date: '2026-02-23' },
      { label: 'Tue (24 Feb)', date: '2026-02-24' },
      { label: 'Wed (25 Feb)', date: '2026-02-25' },
      { label: 'Thu (26 Feb)', date: '2026-02-26' },
    ])
  })

  it('always has Today as the first option', () => {
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const date = new Date(2026, 1, 16 + dayOffset)
      const options = getStartDateOptions(date)
      expect(options[0]!.label).toBe('Today')
    }
  })

  it('always has Tomorrow as the second option', () => {
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const date = new Date(2026, 1, 16 + dayOffset)
      const options = getStartDateOptions(date)
      expect(options[1]!.label).toBe('Tomorrow')
    }
  })

  it('uses consecutive dates for all options', () => {
    const monday = new Date(2026, 1, 16)
    const options = getStartDateOptions(monday)

    expect(options[0]!.date).toBe('2026-02-16')
    expect(options[1]!.date).toBe('2026-02-17')
    expect(options[2]!.date).toBe('2026-02-18')
    expect(options[3]!.date).toBe('2026-02-19')
    expect(options[4]!.date).toBe('2026-02-20')
  })

  it('handles month boundary correctly', () => {
    const jan30 = new Date(2026, 0, 30) // Fri 30 Jan 2026
    const options = getStartDateOptions(jan30)

    expect(options).toEqual([
      { label: 'Today', date: '2026-01-30' },
      { label: 'Tomorrow', date: '2026-01-31' },
      { label: 'Sun (1 Feb)', date: '2026-02-01' },
      { label: 'Mon (2 Feb)', date: '2026-02-02' },
      { label: 'Tue (3 Feb)', date: '2026-02-03' },
    ])
  })

  it('handles year boundary correctly', () => {
    const dec31 = new Date(2025, 11, 31) // Wed 31 Dec 2025
    const options = getStartDateOptions(dec31)

    expect(options).toEqual([
      { label: 'Today', date: '2025-12-31' },
      { label: 'Tomorrow', date: '2026-01-01' },
      { label: 'Fri (2 Jan)', date: '2026-01-02' },
      { label: 'Sat (3 Jan)', date: '2026-01-03' },
      { label: 'Sun (4 Jan)', date: '2026-01-04' },
    ])
  })
})

describe('getDaysCountOptions', () => {
  it('returns 5 options', () => {
    const options = getDaysCountOptions()
    expect(options).toHaveLength(5)
  })

  it('returns the correct values and labels', () => {
    const options = getDaysCountOptions()

    expect(options).toEqual([
      { value: 3, label: '3 days' },
      { value: 5, label: '5 days' },
      { value: 7, label: '7 days' },
      { value: 10, label: '10 days' },
      { value: 14, label: '14 days' },
    ])
  })

  it('returns options in ascending order', () => {
    const options = getDaysCountOptions()
    const values = options.map((o) => o.value)

    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]!)
    }
  })
})

describe('computeEndDate', () => {
  it('computes end date 7 days from start', () => {
    expect(computeEndDate('2026-02-16', 7)).toBe('2026-02-23')
  })

  it('computes end date 3 days from start', () => {
    expect(computeEndDate('2026-02-16', 3)).toBe('2026-02-19')
  })

  it('computes end date 14 days from start', () => {
    expect(computeEndDate('2026-02-16', 14)).toBe('2026-03-02')
  })

  it('handles month boundary', () => {
    expect(computeEndDate('2026-01-28', 7)).toBe('2026-02-04')
  })

  it('handles year boundary', () => {
    expect(computeEndDate('2025-12-28', 7)).toBe('2026-01-04')
  })

  it('computes end date 1 day from start', () => {
    expect(computeEndDate('2026-02-16', 1)).toBe('2026-02-17')
  })

  it('handles leap year', () => {
    // 2028 is a leap year
    expect(computeEndDate('2028-02-27', 5)).toBe('2028-03-03')
  })
})
