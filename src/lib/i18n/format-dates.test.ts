import { describe, it, expect } from 'vitest'
import {
  formatAbsoluteDate,
  formatDateRange,
  formatDayMonth,
  formatDayShort,
  formatDayLong,
  formatDateDisplay,
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
})
