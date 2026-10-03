import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
