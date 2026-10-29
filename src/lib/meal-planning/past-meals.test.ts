import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { mealPlanEntry: { count: vi.fn() } },
}))

import { prisma } from '@/lib/prisma'

import { countPastMealsToMark, getPastMealsRange } from './past-meals'

describe('getPastMealsRange', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs from 7 days ago up to today, exclusive, in the household timezone', () => {
    // 22:30 UTC on 29 March is already 30 March in Tallinn (UTC+3).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-29T22:30:00Z'))

    const { todayDate, startDate, endDate } = getPastMealsRange('Europe/Tallinn')

    expect(todayDate).toBe('2026-03-30')
    expect(endDate).toEqual(new Date(2026, 2, 30))
    expect(startDate).toEqual(new Date(2026, 2, 23))
  })

  describe('with weeks and the household creation day (HON-1383)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      // 09:00 UTC on 30 March is noon on the 30th in Tallinn.
      vi.setSystemTime(new Date('2026-03-30T09:00:00Z'))
    })

    it('reaches back 14 days for two weeks and offers a third', () => {
      const range = getPastMealsRange('Europe/Tallinn', {
        weeks: 2,
        createdAt: new Date('2026-01-05T10:00:00Z'),
      })

      expect(range.startDate).toEqual(new Date(2026, 2, 16))
      expect(range.endDate).toEqual(new Date(2026, 2, 30))
      expect(range.hasEarlierWeek).toBe(true)
    })

    it('stops at the week that holds the creation day', () => {
      // 23:30 UTC on 19 March is already the 20th in Tallinn: 10 days back,
      // in the second week.
      const range = getPastMealsRange('Europe/Tallinn', {
        weeks: 5,
        createdAt: new Date('2026-03-19T23:30:00Z'),
      })

      expect(range.weeks).toBe(2)
      expect(range.startDate).toEqual(new Date(2026, 2, 16))
      expect(range.hasEarlierWeek).toBe(false)
    })

    it('offers the second week while the creation day is in it', () => {
      const range = getPastMealsRange('Europe/Tallinn', {
        createdAt: new Date('2026-03-19T23:30:00Z'),
      })

      expect(range.startDate).toEqual(new Date(2026, 2, 23))
      expect(range.hasEarlierWeek).toBe(true)
    })

    it('offers no earlier week when the first week starts on the creation day', () => {
      const range = getPastMealsRange('Europe/Tallinn', {
        createdAt: new Date('2026-03-23T08:00:00Z'),
      })

      expect(range.startDate).toEqual(new Date(2026, 2, 23))
      expect(range.hasEarlierWeek).toBe(false)
    })

    it('still shows the first week for a household created today', () => {
      const range = getPastMealsRange('Europe/Tallinn', {
        createdAt: new Date('2026-03-30T06:00:00Z'),
      })

      expect(range.startDate).toEqual(new Date(2026, 2, 23))
      expect(range.hasEarlierWeek).toBe(false)
    })

    it('reads a missing or broken weeks count as one week', () => {
      expect(getPastMealsRange('Europe/Tallinn', { weeks: 0 }).startDate).toEqual(
        new Date(2026, 2, 23),
      )
      expect(getPastMealsRange('Europe/Tallinn', { weeks: Number.NaN }).startDate).toEqual(
        new Date(2026, 2, 23),
      )
    })
  })
})

describe('countPastMealsToMark', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-30T09:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts planned past entries with a meal, in one count query', async () => {
    vi.mocked(prisma.mealPlanEntry.count).mockResolvedValue(4)

    await expect(countPastMealsToMark({ id: 'household-1', timezone: 'UTC' })).resolves.toBe(4)

    expect(prisma.mealPlanEntry.count).toHaveBeenCalledTimes(1)
    expect(prisma.mealPlanEntry.count).toHaveBeenCalledWith({
      where: {
        plan: { householdId: 'household-1' },
        date: { gte: new Date(2026, 2, 23), lt: new Date(2026, 2, 30) },
        status: 'planned',
        mealId: { not: null },
      },
    })
  })
})
