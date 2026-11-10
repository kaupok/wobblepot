import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  compareNeededBy,
  getStartOfTodayInTimezone,
  getTodayInTimezone,
  getUrgencyBucket,
  parseLocalDate,
  toDateString,
} from './dates'

describe('dates utilities', () => {
  describe('toDateString', () => {
    it('formats date as YYYY-MM-DD', () => {
      const date = new Date(2025, 0, 13) // January 13, 2025
      expect(toDateString(date)).toBe('2025-01-13')
    })

    it('pads single-digit months with zero', () => {
      const date = new Date(2025, 0, 5) // January 5, 2025
      expect(toDateString(date)).toBe('2025-01-05')
    })

    it('pads single-digit days with zero', () => {
      const date = new Date(2025, 11, 9) // December 9, 2025
      expect(toDateString(date)).toBe('2025-12-09')
    })

    it('handles double-digit months and days', () => {
      const date = new Date(2025, 11, 25) // December 25, 2025
      expect(toDateString(date)).toBe('2025-12-25')
    })
  })

  describe('parseLocalDate', () => {
    it('parses YYYY-MM-DD string as local midnight', () => {
      const date = parseLocalDate('2025-01-13')
      expect(date.getFullYear()).toBe(2025)
      expect(date.getMonth()).toBe(0) // January
      expect(date.getDate()).toBe(13)
      expect(date.getHours()).toBe(0)
      expect(date.getMinutes()).toBe(0)
      expect(date.getSeconds()).toBe(0)
    })

    it('round-trips with toDateString', () => {
      const original = '2025-06-15'
      const parsed = parseLocalDate(original)
      const formatted = toDateString(parsed)
      expect(formatted).toBe(original)
    })

    it('handles edge case months correctly', () => {
      expect(parseLocalDate('2025-01-01').getMonth()).toBe(0) // January
      expect(parseLocalDate('2025-12-31').getMonth()).toBe(11) // December
    })

    it('throws error for invalid format - wrong number of parts', () => {
      expect(() => parseLocalDate('2025-01')).toThrow('Invalid date format')
      expect(() => parseLocalDate('2025')).toThrow('Invalid date format')
      expect(() => parseLocalDate('2025-01-01-01')).toThrow('Invalid date format')
    })

    it('throws error for invalid format - non-numeric parts', () => {
      expect(() => parseLocalDate('abc-01-01')).toThrow('Invalid date format')
      expect(() => parseLocalDate('2025-ab-01')).toThrow('Invalid date format')
      expect(() => parseLocalDate('2025-01-xy')).toThrow('Invalid date format')
    })

    it('throws error for empty string', () => {
      expect(() => parseLocalDate('')).toThrow('Invalid date format')
    })
  })

  describe('getTodayInTimezone', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns date in YYYY-MM-DD format', () => {
      vi.setSystemTime(new Date('2025-01-15T12:00:00Z'))
      const result = getTodayInTimezone('UTC')
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('returns correct date for UTC timezone', () => {
      vi.setSystemTime(new Date('2025-01-15T12:00:00Z'))
      expect(getTodayInTimezone('UTC')).toBe('2025-01-15')
    })

    it('returns previous day for LA when it is early morning UTC', () => {
      // 2:00 AM UTC on Jan 15 = 6:00 PM on Jan 14 in LA (UTC-8)
      vi.setSystemTime(new Date('2025-01-15T02:00:00Z'))
      expect(getTodayInTimezone('America/Los_Angeles')).toBe('2025-01-14')
    })

    it('returns next day for Tokyo when it is late evening UTC', () => {
      // 8:00 PM UTC on Jan 14 = 5:00 AM on Jan 15 in Tokyo (UTC+9)
      vi.setSystemTime(new Date('2025-01-14T20:00:00Z'))
      expect(getTodayInTimezone('Asia/Tokyo')).toBe('2025-01-15')
    })

    it('returns same day for Europe/Tallinn during business hours', () => {
      // 10:00 AM UTC on Jan 15 = 12:00 PM on Jan 15 in Tallinn (UTC+2)
      vi.setSystemTime(new Date('2025-01-15T10:00:00Z'))
      expect(getTodayInTimezone('Europe/Tallinn')).toBe('2025-01-15')
    })
  })

  describe('getStartOfTodayInTimezone', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns a Date object at midnight', () => {
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
      const result = getStartOfTodayInTimezone('UTC')
      expect(result).toBeInstanceOf(Date)
      expect(result.getHours()).toBe(0)
      expect(result.getMinutes()).toBe(0)
      expect(result.getSeconds()).toBe(0)
    })

    it('returns correct date for UTC timezone', () => {
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
      const result = getStartOfTodayInTimezone('UTC')
      expect(toDateString(result)).toBe('2026-01-15')
    })

    it('returns previous day for LA when it is early morning UTC', () => {
      // 2:00 AM UTC on Jan 15 = 6:00 PM on Jan 14 in LA (UTC-8)
      vi.setSystemTime(new Date('2026-01-15T02:00:00Z'))
      const result = getStartOfTodayInTimezone('America/Los_Angeles')
      expect(toDateString(result)).toBe('2026-01-14')
    })

    it('returns next day for Tokyo when it is late evening UTC', () => {
      // 8:00 PM UTC on Jan 14 = 5:00 AM on Jan 15 in Tokyo (UTC+9)
      vi.setSystemTime(new Date('2026-01-14T20:00:00Z'))
      const result = getStartOfTodayInTimezone('Asia/Tokyo')
      expect(toDateString(result)).toBe('2026-01-15')
    })

    it('returns Date suitable for database comparison', () => {
      vi.setSystemTime(new Date('2026-01-15T10:00:00Z'))
      const result = getStartOfTodayInTimezone('Europe/Tallinn')
      // Should be usable in date comparisons
      const futureDate = new Date('2026-01-16')
      const pastDate = new Date('2026-01-14')
      expect(futureDate >= result).toBe(true)
      expect(pastDate >= result).toBe(false)
    })
  })

  describe('compareNeededBy', () => {
    it('orders dates earliest first, with an undated staple last (HON-1647)', () => {
      expect(['2026-01-21', null, '2026-01-20'].sort(compareNeededBy)).toEqual([
        '2026-01-20',
        '2026-01-21',
        null,
      ])
    })
  })

  describe('getUrgencyBucket', () => {
    it('returns "staples" for a staple with no date (HON-1647)', () => {
      expect(getUrgencyBucket(null, new Date('2026-01-20'))).toBe('staples')
    })

    it('returns "today" for same day', () => {
      const reference = new Date('2026-01-20') // Tuesday
      expect(getUrgencyBucket('2026-01-20', reference)).toBe('today')
    })

    it('returns "today" for past dates', () => {
      const reference = new Date('2026-01-20')
      expect(getUrgencyBucket('2026-01-18', reference)).toBe('today')
      expect(getUrgencyBucket('2026-01-15', reference)).toBe('today')
    })

    it('returns "tomorrow" for next day', () => {
      const reference = new Date('2026-01-20') // Tuesday
      expect(getUrgencyBucket('2026-01-21', reference)).toBe('tomorrow')
    })

    it('returns "this-week" for dates within current week', () => {
      // Tuesday, Jan 20, 2026 - Sunday is Jan 25
      const tuesday = new Date('2026-01-20')
      expect(getUrgencyBucket('2026-01-22', tuesday)).toBe('this-week') // Thursday
      expect(getUrgencyBucket('2026-01-23', tuesday)).toBe('this-week') // Friday
      expect(getUrgencyBucket('2026-01-24', tuesday)).toBe('this-week') // Saturday
      expect(getUrgencyBucket('2026-01-25', tuesday)).toBe('this-week') // Sunday
    })

    it('returns "later" for dates after current week', () => {
      // Tuesday, Jan 20, 2026 - next week starts Monday Jan 26
      const tuesday = new Date('2026-01-20')
      expect(getUrgencyBucket('2026-01-26', tuesday)).toBe('later') // Next Monday
      expect(getUrgencyBucket('2026-01-30', tuesday)).toBe('later')
      expect(getUrgencyBucket('2026-02-15', tuesday)).toBe('later')
    })

    it('handles Sunday edge case - when today is Sunday, daysUntilSunday is 0', () => {
      // Sunday, Jan 25, 2026
      const sunday = new Date('2026-01-25')
      expect(getUrgencyBucket('2026-01-25', sunday)).toBe('today') // Today
      expect(getUrgencyBucket('2026-01-26', sunday)).toBe('tomorrow') // Monday
      expect(getUrgencyBucket('2026-01-27', sunday)).toBe('later') // Next week Tuesday
    })

    it('handles Monday start of week', () => {
      // Monday, Jan 19, 2026 - week ends Sunday Jan 25
      const monday = new Date('2026-01-19')
      expect(getUrgencyBucket('2026-01-19', monday)).toBe('today')
      expect(getUrgencyBucket('2026-01-20', monday)).toBe('tomorrow')
      expect(getUrgencyBucket('2026-01-21', monday)).toBe('this-week')
      expect(getUrgencyBucket('2026-01-25', monday)).toBe('this-week') // Sunday
      expect(getUrgencyBucket('2026-01-26', monday)).toBe('later') // Next Monday
    })

    it('handles Saturday - one day before end of week', () => {
      // Saturday, Jan 24, 2026 - Sunday is Jan 25
      const saturday = new Date('2026-01-24')
      expect(getUrgencyBucket('2026-01-24', saturday)).toBe('today')
      expect(getUrgencyBucket('2026-01-25', saturday)).toBe('tomorrow') // Sunday
      expect(getUrgencyBucket('2026-01-26', saturday)).toBe('later') // Next week
    })

    it('uses current date as reference when not provided', () => {
      // This test verifies the function works without a reference date
      const tomorrow = new Date()
      tomorrow.setHours(0, 0, 0, 0)
      tomorrow.setDate(tomorrow.getDate() + 1)
      const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
      expect(getUrgencyBucket(tomorrowStr)).toBe('tomorrow')
    })

    it('handles dates crossing month boundaries', () => {
      // Friday, Jan 30, 2026 - week ends Sunday Feb 1
      const friday = new Date('2026-01-30')
      expect(getUrgencyBucket('2026-01-31', friday)).toBe('tomorrow') // Saturday
      expect(getUrgencyBucket('2026-02-01', friday)).toBe('this-week') // Sunday
      expect(getUrgencyBucket('2026-02-02', friday)).toBe('later') // Next Monday
    })
  })
})
