import { describe, it, expect } from 'vitest'
import { getStartDateOptions, getDaysCountOptions, computeEndDate } from './day-picker'
import type { DatesTranslator } from '@/lib/i18n/format-dates'

const enT: DatesTranslator = (key, params) => {
  if (key === 'inDays' && params?.count !== undefined) return `In ${params.count} days`
  if (key === 'today') return 'Today'
  if (key === 'tomorrow') return 'Tomorrow'
  if (key === 'past') return 'Past'
  return key
}

describe('getStartDateOptions', () => {
  it('returns 5 options starting from today', () => {
    const monday = new Date(2026, 1, 16) // Mon 16 Feb 2026
    const options = getStartDateOptions({ today: monday, locale: 'en', t: enT })

    expect(options).toHaveLength(5)
  })

  it('returns Today, Tomorrow, then 3 named days for Monday (16 Feb)', () => {
    const monday = new Date(2026, 1, 16) // Mon 16 Feb 2026
    const options = getStartDateOptions({ today: monday, locale: 'en', t: enT })

    expect(options).toEqual([
      { label: 'Today', date: '2026-02-16' },
      { label: 'Tomorrow', date: '2026-02-17' },
      { label: 'Wed (Feb 18)', date: '2026-02-18' },
      { label: 'Thu (Feb 19)', date: '2026-02-19' },
      { label: 'Fri (Feb 20)', date: '2026-02-20' },
    ])
  })

  it('returns correct options for Thursday (19 Feb)', () => {
    const thursday = new Date(2026, 1, 19) // Thu 19 Feb 2026
    const options = getStartDateOptions({ today: thursday, locale: 'en', t: enT })

    expect(options).toEqual([
      { label: 'Today', date: '2026-02-19' },
      { label: 'Tomorrow', date: '2026-02-20' },
      { label: 'Sat (Feb 21)', date: '2026-02-21' },
      { label: 'Sun (Feb 22)', date: '2026-02-22' },
      { label: 'Mon (Feb 23)', date: '2026-02-23' },
    ])
  })

  it('always has Today as the first option', () => {
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const date = new Date(2026, 1, 16 + dayOffset)
      const options = getStartDateOptions({ today: date, locale: 'en', t: enT })
      expect(options[0]!.label).toBe('Today')
    }
  })

  it('always has Tomorrow as the second option', () => {
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const date = new Date(2026, 1, 16 + dayOffset)
      const options = getStartDateOptions({ today: date, locale: 'en', t: enT })
      expect(options[1]!.label).toBe('Tomorrow')
    }
  })

  it('uses consecutive dates for all options', () => {
    const monday = new Date(2026, 1, 16)
    const options = getStartDateOptions({ today: monday, locale: 'en', t: enT })

    expect(options[0]!.date).toBe('2026-02-16')
    expect(options[1]!.date).toBe('2026-02-17')
    expect(options[2]!.date).toBe('2026-02-18')
    expect(options[3]!.date).toBe('2026-02-19')
    expect(options[4]!.date).toBe('2026-02-20')
  })

  it('handles month boundary correctly', () => {
    const jan30 = new Date(2026, 0, 30) // Fri 30 Jan 2026
    const options = getStartDateOptions({ today: jan30, locale: 'en', t: enT })

    expect(options).toEqual([
      { label: 'Today', date: '2026-01-30' },
      { label: 'Tomorrow', date: '2026-01-31' },
      { label: 'Sun (Feb 1)', date: '2026-02-01' },
      { label: 'Mon (Feb 2)', date: '2026-02-02' },
      { label: 'Tue (Feb 3)', date: '2026-02-03' },
    ])
  })

  it('uses Estonian locale formatting for the named-day labels', () => {
    const monday = new Date(2026, 1, 16)
    const etT: DatesTranslator = (key) => {
      if (key === 'today') return 'Täna'
      if (key === 'tomorrow') return 'Homme'
      return key
    }
    const options = getStartDateOptions({ today: monday, locale: 'et', t: etT })

    expect(options[0]!.label).toBe('Täna')
    expect(options[1]!.label).toBe('Homme')
    // Estonian Wednesday short = "K"; February abbreviation = "veebr".
    // We don't pin the exact format because Intl punctuation can vary by ICU
    // version, but we assert the locale is taking effect.
    expect(options[2]!.label.toLowerCase()).toContain('veebr')
  })
})

describe('getDaysCountOptions', () => {
  it('returns 5 options', () => {
    const options = getDaysCountOptions()
    expect(options).toHaveLength(5)
  })

  it('returns the correct values', () => {
    const options = getDaysCountOptions()

    expect(options).toEqual([
      { value: 3 },
      { value: 5 },
      { value: 7 },
      { value: 10 },
      { value: 14 },
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
