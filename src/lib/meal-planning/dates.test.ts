import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getNextMonday,
  getWeekDates,
  toDateString,
  parseLocalDate,
  isMonday,
  formatDateDisplay,
  getCurrentWeekMonday,
  isSunday,
  getDaysRemaining,
  getRemainingWeekDates,
  getTodayInTimezone,
  formatRelativeDate,
  formatAbsoluteDate,
  getStartOfTodayInTimezone,
  getUrgencyBucket,
} from './dates'

describe('dates utilities', () => {
  describe('getNextMonday', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns next Monday when today is Sunday', () => {
      // Sunday, January 12, 2025
      vi.setSystemTime(new Date(2025, 0, 12, 10, 0, 0))
      const nextMonday = getNextMonday()
      expect(nextMonday.getDay()).toBe(1) // Monday
      expect(toDateString(nextMonday)).toBe('2025-01-13')
    })

    it('returns next week Monday when today is Monday', () => {
      // Monday, January 13, 2025
      vi.setSystemTime(new Date(2025, 0, 13, 10, 0, 0))
      const nextMonday = getNextMonday()
      expect(nextMonday.getDay()).toBe(1)
      expect(toDateString(nextMonday)).toBe('2025-01-20')
    })

    it('returns next Monday when today is Tuesday', () => {
      // Tuesday, January 14, 2025
      vi.setSystemTime(new Date(2025, 0, 14, 10, 0, 0))
      const nextMonday = getNextMonday()
      expect(nextMonday.getDay()).toBe(1)
      expect(toDateString(nextMonday)).toBe('2025-01-20')
    })

    it('returns next Monday when today is Wednesday', () => {
      // Wednesday, January 15, 2025
      vi.setSystemTime(new Date(2025, 0, 15, 10, 0, 0))
      const nextMonday = getNextMonday()
      expect(nextMonday.getDay()).toBe(1)
      expect(toDateString(nextMonday)).toBe('2025-01-20')
    })

    it('returns next Monday when today is Saturday', () => {
      // Saturday, January 18, 2025
      vi.setSystemTime(new Date(2025, 0, 18, 10, 0, 0))
      const nextMonday = getNextMonday()
      expect(nextMonday.getDay()).toBe(1)
      expect(toDateString(nextMonday)).toBe('2025-01-20')
    })

    it('returns date at midnight', () => {
      vi.setSystemTime(new Date(2025, 0, 15, 14, 30, 45))
      const nextMonday = getNextMonday()
      expect(nextMonday.getHours()).toBe(0)
      expect(nextMonday.getMinutes()).toBe(0)
      expect(nextMonday.getSeconds()).toBe(0)
      expect(nextMonday.getMilliseconds()).toBe(0)
    })
  })

  describe('getWeekDates', () => {
    it('returns 7 consecutive dates starting from the given date', () => {
      const startDate = new Date(2025, 0, 13) // Monday, January 13, 2025
      const dates = getWeekDates(startDate)

      expect(dates).toHaveLength(7)
      expect(toDateString(dates[0]!)).toBe('2025-01-13')
      expect(toDateString(dates[1]!)).toBe('2025-01-14')
      expect(toDateString(dates[2]!)).toBe('2025-01-15')
      expect(toDateString(dates[3]!)).toBe('2025-01-16')
      expect(toDateString(dates[4]!)).toBe('2025-01-17')
      expect(toDateString(dates[5]!)).toBe('2025-01-18')
      expect(toDateString(dates[6]!)).toBe('2025-01-19')
    })

    it('handles month boundaries correctly', () => {
      const startDate = new Date(2025, 0, 29) // Wednesday, January 29, 2025
      const dates = getWeekDates(startDate)

      expect(dates).toHaveLength(7)
      expect(toDateString(dates[0]!)).toBe('2025-01-29')
      expect(toDateString(dates[3]!)).toBe('2025-02-01')
      expect(toDateString(dates[6]!)).toBe('2025-02-04')
    })

    it('handles year boundaries correctly', () => {
      const startDate = new Date(2024, 11, 30) // Monday, December 30, 2024
      const dates = getWeekDates(startDate)

      expect(dates).toHaveLength(7)
      expect(toDateString(dates[0]!)).toBe('2024-12-30')
      expect(toDateString(dates[2]!)).toBe('2025-01-01')
      expect(toDateString(dates[6]!)).toBe('2025-01-05')
    })

    it('does not mutate the original date', () => {
      const startDate = new Date(2025, 0, 13)
      const originalTime = startDate.getTime()
      getWeekDates(startDate)
      expect(startDate.getTime()).toBe(originalTime)
    })
  })

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

  describe('isMonday', () => {
    it('returns true for Monday', () => {
      const monday = new Date(2025, 0, 13) // Monday, January 13, 2025
      expect(isMonday(monday)).toBe(true)
    })

    it('returns false for other days', () => {
      expect(isMonday(new Date(2025, 0, 12))).toBe(false) // Sunday
      expect(isMonday(new Date(2025, 0, 14))).toBe(false) // Tuesday
      expect(isMonday(new Date(2025, 0, 15))).toBe(false) // Wednesday
      expect(isMonday(new Date(2025, 0, 16))).toBe(false) // Thursday
      expect(isMonday(new Date(2025, 0, 17))).toBe(false) // Friday
      expect(isMonday(new Date(2025, 0, 18))).toBe(false) // Saturday
    })
  })

  describe('formatDateDisplay', () => {
    it('formats date with day name and YYYY-MM-DD', () => {
      const monday = new Date(2025, 0, 13)
      expect(formatDateDisplay(monday)).toBe('Mon 2025-01-13')
    })

    it('handles all days of the week', () => {
      expect(formatDateDisplay(new Date(2025, 0, 12))).toBe('Sun 2025-01-12')
      expect(formatDateDisplay(new Date(2025, 0, 13))).toBe('Mon 2025-01-13')
      expect(formatDateDisplay(new Date(2025, 0, 14))).toBe('Tue 2025-01-14')
      expect(formatDateDisplay(new Date(2025, 0, 15))).toBe('Wed 2025-01-15')
      expect(formatDateDisplay(new Date(2025, 0, 16))).toBe('Thu 2025-01-16')
      expect(formatDateDisplay(new Date(2025, 0, 17))).toBe('Fri 2025-01-17')
      expect(formatDateDisplay(new Date(2025, 0, 18))).toBe('Sat 2025-01-18')
    })
  })

  describe('getCurrentWeekMonday', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns today when today is Monday', () => {
      // Monday, January 13, 2025
      vi.setSystemTime(new Date(2025, 0, 13, 10, 0, 0))
      const monday = getCurrentWeekMonday()
      expect(toDateString(monday)).toBe('2025-01-13')
    })

    it('returns previous Monday when today is Tuesday', () => {
      // Tuesday, January 14, 2025
      vi.setSystemTime(new Date(2025, 0, 14, 10, 0, 0))
      const monday = getCurrentWeekMonday()
      expect(toDateString(monday)).toBe('2025-01-13')
    })

    it('returns previous Monday when today is Wednesday', () => {
      // Wednesday, January 15, 2025
      vi.setSystemTime(new Date(2025, 0, 15, 10, 0, 0))
      const monday = getCurrentWeekMonday()
      expect(toDateString(monday)).toBe('2025-01-13')
    })

    it('returns previous Monday when today is Sunday', () => {
      // Sunday, January 19, 2025
      vi.setSystemTime(new Date(2025, 0, 19, 10, 0, 0))
      const monday = getCurrentWeekMonday()
      expect(toDateString(monday)).toBe('2025-01-13')
    })

    it('returns date at midnight', () => {
      vi.setSystemTime(new Date(2025, 0, 15, 14, 30, 45))
      const monday = getCurrentWeekMonday()
      expect(monday.getHours()).toBe(0)
      expect(monday.getMinutes()).toBe(0)
    })
  })

  describe('isSunday', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns true for Sunday', () => {
      const sunday = new Date(2025, 0, 12) // Sunday, January 12, 2025
      expect(isSunday(sunday)).toBe(true)
    })

    it('returns false for other days', () => {
      expect(isSunday(new Date(2025, 0, 13))).toBe(false) // Monday
      expect(isSunday(new Date(2025, 0, 14))).toBe(false) // Tuesday
      expect(isSunday(new Date(2025, 0, 15))).toBe(false) // Wednesday
      expect(isSunday(new Date(2025, 0, 16))).toBe(false) // Thursday
      expect(isSunday(new Date(2025, 0, 17))).toBe(false) // Friday
      expect(isSunday(new Date(2025, 0, 18))).toBe(false) // Saturday
    })

    it('uses current date when no argument provided', () => {
      vi.setSystemTime(new Date(2025, 0, 12, 10, 0, 0)) // Sunday
      expect(isSunday()).toBe(true)

      vi.setSystemTime(new Date(2025, 0, 13, 10, 0, 0)) // Monday
      expect(isSunday()).toBe(false)
    })
  })

  describe('getDaysRemaining', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns 7 on Monday', () => {
      vi.setSystemTime(new Date(2025, 0, 13, 10, 0, 0)) // Monday
      expect(getDaysRemaining()).toBe(7)
    })

    it('returns 6 on Tuesday', () => {
      vi.setSystemTime(new Date(2025, 0, 14, 10, 0, 0)) // Tuesday
      expect(getDaysRemaining()).toBe(6)
    })

    it('returns 5 on Wednesday', () => {
      vi.setSystemTime(new Date(2025, 0, 15, 10, 0, 0)) // Wednesday
      expect(getDaysRemaining()).toBe(5)
    })

    it('returns 2 on Saturday', () => {
      vi.setSystemTime(new Date(2025, 0, 18, 10, 0, 0)) // Saturday
      expect(getDaysRemaining()).toBe(2)
    })

    it('returns 1 on Sunday', () => {
      vi.setSystemTime(new Date(2025, 0, 19, 10, 0, 0)) // Sunday
      expect(getDaysRemaining()).toBe(1)
    })

    it('respects timezone parameter when provided', () => {
      // Set system time to Thursday midnight UTC (2025-01-16 00:00:00 UTC)
      // In Europe/Tallinn (UTC+2), this is Thursday 02:00
      // In America/Los_Angeles (UTC-8), this is still Wednesday 16:00
      vi.setSystemTime(new Date(Date.UTC(2025, 0, 16, 0, 0, 0)))

      // In Tallinn, it's Thursday -> 4 days remaining (Thu-Sun)
      expect(getDaysRemaining('Europe/Tallinn')).toBe(4)

      // In LA, it's still Wednesday -> 5 days remaining (Wed-Sun)
      expect(getDaysRemaining('America/Los_Angeles')).toBe(5)
    })

    it('handles timezone around midnight correctly', () => {
      // Set system time to Monday 01:00 UTC (2025-01-13 01:00:00 UTC)
      // In Europe/Tallinn (UTC+2), this is Monday 03:00
      // In America/Los_Angeles (UTC-8), this is still Sunday 17:00
      vi.setSystemTime(new Date(Date.UTC(2025, 0, 13, 1, 0, 0)))

      // In Tallinn, it's Monday -> 7 days remaining
      expect(getDaysRemaining('Europe/Tallinn')).toBe(7)

      // In LA, it's still Sunday -> 1 day remaining
      expect(getDaysRemaining('America/Los_Angeles')).toBe(1)
    })
  })

  describe('getRemainingWeekDates', () => {
    it('returns full week when starting Monday', () => {
      const monday = new Date(2025, 0, 13) // Monday
      const dates = getRemainingWeekDates(monday)
      expect(dates).toHaveLength(7)
      expect(toDateString(dates[0]!)).toBe('2025-01-13') // Monday
      expect(toDateString(dates[6]!)).toBe('2025-01-19') // Sunday
    })

    it('returns 5 days when starting Wednesday', () => {
      const wednesday = new Date(2025, 0, 15) // Wednesday
      const dates = getRemainingWeekDates(wednesday)
      expect(dates).toHaveLength(5)
      expect(toDateString(dates[0]!)).toBe('2025-01-15') // Wednesday
      expect(toDateString(dates[4]!)).toBe('2025-01-19') // Sunday
    })

    it('returns 2 days when starting Saturday', () => {
      const saturday = new Date(2025, 0, 18) // Saturday
      const dates = getRemainingWeekDates(saturday)
      expect(dates).toHaveLength(2)
      expect(toDateString(dates[0]!)).toBe('2025-01-18') // Saturday
      expect(toDateString(dates[1]!)).toBe('2025-01-19') // Sunday
    })

    it('returns 1 day when starting Sunday', () => {
      const sunday = new Date(2025, 0, 19) // Sunday
      const dates = getRemainingWeekDates(sunday)
      expect(dates).toHaveLength(1)
      expect(toDateString(dates[0]!)).toBe('2025-01-19') // Sunday
    })

    it('normalizes start date to midnight', () => {
      const wednesday = new Date(2025, 0, 15, 14, 30, 45) // Wed with time
      const dates = getRemainingWeekDates(wednesday)
      expect(dates[0]!.getHours()).toBe(0)
      expect(dates[0]!.getMinutes()).toBe(0)
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

  describe('formatRelativeDate', () => {
    it('returns "Today" for same day', () => {
      const today = new Date('2026-01-20')
      const reference = new Date('2026-01-20')
      expect(formatRelativeDate(today, reference)).toBe('Today')
    })

    it('returns "Tomorrow" for next day', () => {
      const tomorrow = new Date('2026-01-21')
      const reference = new Date('2026-01-20')
      expect(formatRelativeDate(tomorrow, reference)).toBe('Tomorrow')
    })

    it('returns day name for dates 2-7 days away', () => {
      const reference = new Date('2026-01-20') // Tuesday

      // 2 days away (Thursday, Jan 22)
      expect(formatRelativeDate(new Date('2026-01-22'), reference)).toBe('Thursday')
      // 3 days away (Friday, Jan 23)
      expect(formatRelativeDate(new Date('2026-01-23'), reference)).toBe('Friday')
      // 7 days away (Tuesday, Jan 27)
      expect(formatRelativeDate(new Date('2026-01-27'), reference)).toBe('Tuesday')
    })

    it('returns "In X days" for dates more than 7 days away', () => {
      const reference = new Date('2026-01-20')
      // 8 days away
      expect(formatRelativeDate(new Date('2026-01-28'), reference)).toBe('In 8 days')
      // 14 days away
      expect(formatRelativeDate(new Date('2026-02-03'), reference)).toBe('In 14 days')
    })

    it('returns "Past" for dates in the past', () => {
      const past = new Date('2026-01-18')
      const reference = new Date('2026-01-20')
      expect(formatRelativeDate(past, reference)).toBe('Past')
    })

    it('uses current date as reference when not provided', () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)
      expect(formatRelativeDate(tomorrow)).toBe('Tomorrow')
    })

    it('handles time differences within same day', () => {
      // Both are Jan 20, regardless of time
      const morning = new Date('2026-01-20T08:00:00')
      const evening = new Date('2026-01-20T20:00:00')
      expect(formatRelativeDate(evening, morning)).toBe('Today')
    })
  })

  describe('formatAbsoluteDate', () => {
    it('formats date as "Jan 20" style', () => {
      const date = new Date('2026-01-20')
      expect(formatAbsoluteDate(date)).toBe('Jan 20')
    })

    it('handles different months', () => {
      expect(formatAbsoluteDate(new Date('2026-02-15'))).toBe('Feb 15')
      expect(formatAbsoluteDate(new Date('2026-12-25'))).toBe('Dec 25')
    })

    it('handles single digit days', () => {
      expect(formatAbsoluteDate(new Date('2026-03-05'))).toBe('Mar 5')
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

  describe('getUrgencyBucket', () => {
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
