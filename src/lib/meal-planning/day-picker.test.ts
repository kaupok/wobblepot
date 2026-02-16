import { describe, it, expect, vi, afterEach } from 'vitest'
import { getDayPickerOptions } from './day-picker'

// Mock getNextMonday since it uses new Date() internally
vi.mock('./dates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./dates')>()
  return {
    ...actual,
    getNextMonday: vi.fn(),
  }
})

import { getNextMonday } from './dates'

const mockGetNextMonday = vi.mocked(getNextMonday)

afterEach(() => {
  vi.clearAllMocks()
})

describe('getDayPickerOptions', () => {
  it('returns correct options for Monday (16 Feb)', () => {
    const monday = new Date(2026, 1, 16) // Mon 16 Feb 2026
    mockGetNextMonday.mockReturnValue(new Date(2026, 1, 23))

    const options = getDayPickerOptions(monday)

    expect(options).toEqual([
      { label: 'Today', date: '2026-02-16' },
      { label: 'Tomorrow', date: '2026-02-17' },
      { label: 'Wed (18 Feb)', date: '2026-02-18' },
      { label: 'Thu (19 Feb)', date: '2026-02-19' },
      { label: 'Fri (20 Feb)', date: '2026-02-20' },
      { label: 'Sat (21 Feb)', date: '2026-02-21' },
      { label: 'Sun (22 Feb)', date: '2026-02-22' },
      { label: 'Next week (23 Feb)', date: '2026-02-23' },
    ])
  })

  it('returns correct options for Thursday (19 Feb)', () => {
    const thursday = new Date(2026, 1, 19) // Thu 19 Feb 2026
    mockGetNextMonday.mockReturnValue(new Date(2026, 1, 23))

    const options = getDayPickerOptions(thursday)

    expect(options).toEqual([
      { label: 'Today', date: '2026-02-19' },
      { label: 'Tomorrow', date: '2026-02-20' },
      { label: 'Sat (21 Feb)', date: '2026-02-21' },
      { label: 'Sun (22 Feb)', date: '2026-02-22' },
      { label: 'Next week (23 Feb)', date: '2026-02-23' },
    ])
  })

  it('returns correct options for Sunday (22 Feb)', () => {
    const sunday = new Date(2026, 1, 22) // Sun 22 Feb 2026
    mockGetNextMonday.mockReturnValue(new Date(2026, 1, 23))

    const options = getDayPickerOptions(sunday)

    expect(options).toEqual([
      { label: 'Today', date: '2026-02-22' },
      { label: 'Next week (23 Feb)', date: '2026-02-23' },
    ])
  })

  it('returns correct options for Saturday (21 Feb)', () => {
    const saturday = new Date(2026, 1, 21) // Sat 21 Feb 2026
    mockGetNextMonday.mockReturnValue(new Date(2026, 1, 23))

    const options = getDayPickerOptions(saturday)

    // Saturday: Today, Sun (22 Feb), Next week — no "Tomorrow" since today is Saturday
    expect(options).toEqual([
      { label: 'Today', date: '2026-02-21' },
      { label: 'Next week (23 Feb)', date: '2026-02-23' },
    ])
  })

  it('returns correct options for Friday (20 Feb)', () => {
    const friday = new Date(2026, 1, 20) // Fri 20 Feb 2026
    mockGetNextMonday.mockReturnValue(new Date(2026, 1, 23))

    const options = getDayPickerOptions(friday)

    expect(options).toEqual([
      { label: 'Today', date: '2026-02-20' },
      { label: 'Tomorrow', date: '2026-02-21' },
      { label: 'Sun (22 Feb)', date: '2026-02-22' },
      { label: 'Next week (23 Feb)', date: '2026-02-23' },
    ])
  })

  it('returns correct options for Tuesday (17 Feb)', () => {
    const tuesday = new Date(2026, 1, 17) // Tue 17 Feb 2026
    mockGetNextMonday.mockReturnValue(new Date(2026, 1, 23))

    const options = getDayPickerOptions(tuesday)

    expect(options).toEqual([
      { label: 'Today', date: '2026-02-17' },
      { label: 'Tomorrow', date: '2026-02-18' },
      { label: 'Thu (19 Feb)', date: '2026-02-19' },
      { label: 'Fri (20 Feb)', date: '2026-02-20' },
      { label: 'Sat (21 Feb)', date: '2026-02-21' },
      { label: 'Sun (22 Feb)', date: '2026-02-22' },
      { label: 'Next week (23 Feb)', date: '2026-02-23' },
    ])
  })

  it('returns correct options for Wednesday (18 Feb)', () => {
    const wednesday = new Date(2026, 1, 18) // Wed 18 Feb 2026
    mockGetNextMonday.mockReturnValue(new Date(2026, 1, 23))

    const options = getDayPickerOptions(wednesday)

    expect(options).toEqual([
      { label: 'Today', date: '2026-02-18' },
      { label: 'Tomorrow', date: '2026-02-19' },
      { label: 'Fri (20 Feb)', date: '2026-02-20' },
      { label: 'Sat (21 Feb)', date: '2026-02-21' },
      { label: 'Sun (22 Feb)', date: '2026-02-22' },
      { label: 'Next week (23 Feb)', date: '2026-02-23' },
    ])
  })

  it('always includes Today as first option', () => {
    // Test for every day of the week
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const date = new Date(2026, 1, 16 + dayOffset)
      mockGetNextMonday.mockReturnValue(new Date(2026, 1, 23))

      const options = getDayPickerOptions(date)
      expect(options[0]!.label).toBe('Today')
    }
  })

  it('always includes Next week as last option', () => {
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const date = new Date(2026, 1, 16 + dayOffset)
      mockGetNextMonday.mockReturnValue(new Date(2026, 1, 23))

      const options = getDayPickerOptions(date)
      expect(options[options.length - 1]!.label).toContain('Next week')
    }
  })
})
