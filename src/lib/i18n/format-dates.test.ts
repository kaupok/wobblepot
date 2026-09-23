import { describe, it, expect } from 'vitest'
import {
  formatAbsoluteDate,
  formatDateRange,
  formatDayMonth,
  formatDayShort,
  formatDayLong,
  formatDateDisplay,
  formatFullDate,
  formatLongDate,
  formatDateTime,
  formatRelativeDate,
  type DatesTranslator,
} from './format-dates'

// 2026-01-12 was a Monday; useful as a deterministic anchor.
const MONDAY = new Date(2026, 0, 12)
const TUESDAY = new Date(2026, 0, 13)

describe('formatAbsoluteDate', () => {
  it('renders en in MMM d form', () => {
    // Apr 5 in en — "Apr 5".
    expect(formatAbsoluteDate(new Date(2026, 3, 5), 'en')).toMatch(/Apr/)
    expect(formatAbsoluteDate(new Date(2026, 3, 5), 'en')).toMatch(/5/)
  })

  it('renders et with a localized month abbreviation', () => {
    // April → "apr"; the period is part of Estonian abbreviation.
    const out = formatAbsoluteDate(new Date(2026, 3, 5), 'et')
    expect(out.toLowerCase()).toContain('apr')
  })
})

describe('formatDateRange', () => {
  it('renders a same-month range in en', () => {
    const out = formatDateRange(new Date(2026, 3, 5), new Date(2026, 3, 11), 'en')
    expect(out).toContain('Apr')
    expect(out).toContain('5')
    expect(out).toContain('11')
  })

  it('renders cross-month ranges with both months in en', () => {
    const out = formatDateRange(new Date(2026, 3, 28), new Date(2026, 4, 4), 'en')
    expect(out).toContain('Apr')
    expect(out).toContain('May')
  })

  it('omits year by default for same-year ranges', () => {
    const out = formatDateRange(new Date(2026, 3, 5), new Date(2026, 3, 11), 'en')
    expect(out).not.toMatch(/\d{4}/)
  })

  it('renders the year exactly once with withYear: true (same-year range)', () => {
    const out = formatDateRange(new Date(2026, 3, 5), new Date(2026, 3, 11), 'en', {
      withYear: true,
    })
    const yearOccurrences = out.match(/2026/g) ?? []
    expect(yearOccurrences.length).toBe(1)
  })

  it('renders both years on a cross-year range without duplication', () => {
    // Cross-year ranges always include the year (ICU forces it). Manually
    // appending another year — the previous bug — would produce
    // "Dec 29, 2025 – Jan 4, 2026, 2026". The new helper lets ICU place years
    // and asserts each year shows up exactly once.
    const out = formatDateRange(new Date(2025, 11, 29), new Date(2026, 0, 4), 'en')
    expect((out.match(/2025/g) ?? []).length).toBe(1)
    expect((out.match(/2026/g) ?? []).length).toBe(1)
  })
})

describe('formatDayMonth', () => {
  it('renders en day-and-month', () => {
    const out = formatDayMonth(new Date(2026, 1, 18), 'en')
    expect(out).toContain('Feb')
    expect(out).toContain('18')
  })

  it('renders et day-and-month with localized abbreviation', () => {
    const out = formatDayMonth(new Date(2026, 1, 18), 'et')
    expect(out).toContain('18')
    // Estonian abbreviation for February typically renders as "veebr" or "veebr.".
    expect(out.toLowerCase()).toContain('veebr')
  })
})

describe('formatDayShort', () => {
  it('renders the short weekday name', () => {
    expect(formatDayShort(MONDAY, 'en')).toMatch(/Mon/i)
  })

  it('renders the short weekday name in et', () => {
    // Estonian short weekday for Monday is typically "E".
    const out = formatDayShort(MONDAY, 'et')
    expect(out.length).toBeGreaterThan(0)
    expect(out.toLowerCase().startsWith('e')).toBe(true)
  })
})

describe('formatDayLong', () => {
  it('renders the long weekday name in en', () => {
    expect(formatDayLong(MONDAY, 'en')).toContain('Monday')
  })

  it('renders the long weekday name in et — guards against missing Intl data', () => {
    // Estonian long weekday for Monday is "esmaspäev". Diacritic + lowercase
    // matters: this assertion fails if the runtime ICU drops `et` data and
    // falls back to English.
    expect(formatDayLong(MONDAY, 'et')).toContain('esmaspäev')
  })

  it('renders the long month name in et — guards against missing Intl data', () => {
    // January in Estonian is "jaanuar". Like the weekday assertion, this
    // catches Intl-data drift on `et`.
    const out = new Intl.DateTimeFormat('et', { month: 'long' }).format(MONDAY)
    expect(out).toBe('jaanuar')
  })
})

describe('formatDateDisplay', () => {
  it('renders short weekday + day + short month in en', () => {
    const out = formatDateDisplay(MONDAY, 'en')
    expect(out).toMatch(/Mon/i)
    expect(out).toMatch(/Jan/i)
    expect(out).toContain('12')
  })
})

describe('timezone interaction', () => {
  it('shifts the displayed calendar day when timeZone moves the date across midnight', () => {
    // 2026-03-15T22:30:00Z is "March 15, 22:30 UTC" but already March 16 in
    // Europe/Tallinn (UTC+2 standard / UTC+3 DST). On 2026-03-15 Tallinn is
    // already in DST (DST in Europe starts the last Sunday of March, but the
    // assertion holds either way: 22:30Z + 2h = 00:30 next day).
    const date = new Date('2026-03-15T22:30:00Z')
    const utc = formatAbsoluteDate(date, 'en', { timeZone: 'UTC' })
    const tallinn = formatAbsoluteDate(date, 'en', { timeZone: 'Europe/Tallinn' })
    expect(utc).toContain('15')
    expect(tallinn).toContain('16')
  })
})

describe('formatRelativeDate', () => {
  // Mock translator that returns predictable, locale-agnostic strings so the
  // assertion is on the relative-date logic, not the catalog content.
  const mockT: DatesTranslator = (key, params) => {
    if (key === 'inDays' && params?.count !== undefined) {
      return `in-${params.count}-days`
    }
    return `[${key}]`
  }

  const reference = new Date(2026, 0, 12) // Monday Jan 12

  it('returns the today translation when target is the same day', () => {
    expect(formatRelativeDate(reference, 'en', mockT, { referenceDate: reference })).toBe('[today]')
  })

  it('returns the tomorrow translation when target is the next day', () => {
    expect(formatRelativeDate(TUESDAY, 'en', mockT, { referenceDate: reference })).toBe(
      '[tomorrow]',
    )
  })

  it('returns the localized weekday name when target is within 7 days', () => {
    // Two days out from Monday Jan 12 → Wednesday Jan 14.
    const wednesday = new Date(2026, 0, 14)
    const en = formatRelativeDate(wednesday, 'en', mockT, { referenceDate: reference })
    expect(en).toContain('Wednesday')

    const et = formatRelativeDate(wednesday, 'et', mockT, { referenceDate: reference })
    expect(et).toContain('kolmapäev')
  })

  it('returns inDays with the diff count when target is more than 7 days out', () => {
    const fortnight = new Date(2026, 0, 26) // Monday Jan 26 — 14 days from reference
    expect(formatRelativeDate(fortnight, 'en', mockT, { referenceDate: reference })).toBe(
      'in-14-days',
    )
  })

  it('returns the past translation when target is before reference', () => {
    const yesterday = new Date(2026, 0, 11)
    expect(formatRelativeDate(yesterday, 'en', mockT, { referenceDate: reference })).toBe('[past]')
  })

  it('uses the supplied timeZone for the calendar-day comparison', () => {
    // 2026-03-15T22:30:00Z is March 15 in UTC but already March 16 in
    // Europe/Tallinn (UTC+2 standard). With `timeZone: 'Europe/Tallinn'`,
    // a March 16 target compared against a March 15-22:30Z reference must
    // therefore land on "today", not "tomorrow".
    const reference22Z = new Date('2026-03-15T22:30:00Z')
    const target = new Date('2026-03-16T01:00:00Z') // March 16 in Tallinn AND UTC
    expect(
      formatRelativeDate(target, 'en', mockT, {
        referenceDate: reference22Z,
        timeZone: 'Europe/Tallinn',
      }),
    ).toBe('[today]')
    // In UTC it's still "tomorrow" (March 15 → March 16) — same args, no tz override.
    expect(
      formatRelativeDate(target, 'en', mockT, {
        referenceDate: reference22Z,
        timeZone: 'UTC',
      }),
    ).toBe('[tomorrow]')
  })
})

describe('formatFullDate', () => {
  it('renders the long weekday, month, day, and year in en', () => {
    const out = formatFullDate(MONDAY, 'en')
    expect(out).toContain('Monday')
    expect(out).toContain('January')
    expect(out).toContain('12')
    expect(out).toContain('2026')
  })

  it('renders localized weekday and month in et — guards against missing Intl data', () => {
    const out = formatFullDate(MONDAY, 'et')
    expect(out).toContain('esmaspäev')
    expect(out.toLowerCase()).toContain('jaanuar')
    expect(out).toContain('2026')
  })
})

describe('formatLongDate', () => {
  // The purge instant the account-deletion flow quotes: 03:00 UTC, the hour the
  // purge cron runs.
  const purgeInstant = new Date('2026-07-05T03:00:00.000Z')

  it('renders month, day, and year in en', () => {
    expect(formatLongDate(purgeInstant, 'en', { timeZone: 'UTC' })).toBe('July 5, 2026')
  })

  it('renders the localized month and Estonian day-first order in et', () => {
    expect(formatLongDate(purgeInstant, 'et', { timeZone: 'UTC' })).toBe('5. juuli 2026')
  })

  it('omits the weekday, unlike formatFullDate', () => {
    expect(formatLongDate(MONDAY, 'en')).not.toContain('Monday')
    expect(formatFullDate(MONDAY, 'en')).toContain('Monday')
  })

  it('honours the timeZone option at a day boundary', () => {
    // 23:30Z is still the 5th in UTC but already the 6th in Tallinn (UTC+3).
    // The deletion dialog and the confirmation email both pass 'UTC' so they
    // never quote the following calendar day.
    const lateDay = new Date('2026-07-05T23:30:00.000Z')

    expect(formatLongDate(lateDay, 'en', { timeZone: 'UTC' })).toBe('July 5, 2026')
    expect(formatLongDate(lateDay, 'en', { timeZone: 'Europe/Tallinn' })).toBe('July 6, 2026')
  })
})

describe('formatDateTime', () => {
  // A fixed instant rendered in a fixed timezone so the assertion never depends
  // on the runtime's ambient zone. 2026-04-05T14:30:00Z.
  const instant = new Date('2026-04-05T14:30:00Z')

  it('renders date and time in en (12-hour clock)', () => {
    const out = formatDateTime(instant, 'en', { timeZone: 'UTC' })
    expect(out).toContain('Apr')
    expect(out).toContain('2026')
    expect(out).toContain('2:30')
  })

  it('renders date and time in et (24-hour clock + localized month)', () => {
    const out = formatDateTime(instant, 'et', { timeZone: 'UTC' })
    expect(out.toLowerCase()).toContain('apr')
    expect(out).toContain('2026')
    // Estonian uses the 24-hour clock — the meaningful locale split vs en's 2:30 PM.
    expect(out).toContain('14:30')
  })
})

// HON-777: Node pads range and day-period separators with U+2009 / U+202F,
// Chrome with a plain space, so an unnormalised range hydrated with React 418.
describe('space normalisation', () => {
  const NON_ASCII_SPACE = /[  ]/

  it.each(['en', 'et'] as const)('renders ranges with plain spaces only in %s', (locale) => {
    const crossMonth = formatDateRange(new Date(2026, 8, 26), new Date(2026, 9, 2), locale)
    const sameMonth = formatDateRange(new Date(2026, 8, 26), new Date(2026, 8, 29), locale)
    expect(crossMonth).not.toMatch(NON_ASCII_SPACE)
    expect(sameMonth).not.toMatch(NON_ASCII_SPACE)
  })

  it('renders an exact en range with U+0020 around the dash', () => {
    expect(formatDateRange(new Date(2026, 8, 26), new Date(2026, 9, 2), 'en')).toBe(
      'Sep 26 – Oct 2',
    )
  })

  it.each(['en', 'et'] as const)(
    'renders a date and time with plain spaces only in %s',
    (locale) => {
      const out = formatDateTime(new Date('2026-04-05T14:30:00Z'), locale, { timeZone: 'UTC' })
      expect(out).not.toMatch(NON_ASCII_SPACE)
    },
  )
})
