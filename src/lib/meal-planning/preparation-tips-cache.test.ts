import { describe, it, expect, vi } from 'vitest'
import { invalidateFutureEntryTips } from './preparation-tips-cache'
import { getStartOfTodayInTimezone } from './dates'

/**
 * A stand-in for Prisma's transaction client exposing only the one model the
 * helper touches, so the assertions read the same spy the helper wrote to.
 */
const fakeTx = () => {
  const updateMany = vi.fn().mockResolvedValue({ count: 0 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the real `tx` is Prisma's full client type; the helper touches one model of it
  return { tx: { mealPlanEntry: { updateMany } } as any, updateMany }
}

const whereOf = (updateMany: ReturnType<typeof vi.fn>) => {
  const [args] = updateMany.mock.calls[0] ?? []
  expect(args, 'updateMany was never called').toBeDefined()
  return args.where
}

describe('invalidateFutureEntryTips', () => {
  it('nulls preparationTips for the household in one updateMany', async () => {
    const { tx, updateMany } = fakeTx()

    await invalidateFutureEntryTips(tx, 'household-123', 'Europe/Tallinn')

    expect(updateMany).toHaveBeenCalledTimes(1)
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        plan: { householdId: 'household-123' },
        servingOverride: null,
        preparationTips: { not: null },
        date: { gte: getStartOfTodayInTimezone('Europe/Tallinn') },
      },
      data: { preparationTips: null },
    })
  })

  it('scopes to another household when asked', async () => {
    const { tx, updateMany } = fakeTx()

    await invalidateFutureEntryTips(tx, 'household-456', 'Europe/Tallinn')

    expect(whereOf(updateMany).plan).toEqual({ householdId: 'household-456' })
  })

  // An entry with a `servingOverride` was priced from that override, not from
  // the member count, so a membership change leaves its tips correct.
  it('excludes entries that carry a serving override', async () => {
    const { tx, updateMany } = fakeTx()

    await invalidateFutureEntryTips(tx, 'household-123', 'Europe/Tallinn')

    expect(whereOf(updateMany).servingOverride).toBeNull()
  })

  // Tips for a meal already cooked are never read again; regenerating them
  // would be pure AI spend.
  it('excludes entries dated before today', async () => {
    const { tx, updateMany } = fakeTx()

    await invalidateFutureEntryTips(tx, 'household-123', 'Europe/Tallinn')

    const { date } = whereOf(updateMany)
    expect(date).toEqual({ gte: getStartOfTodayInTimezone('Europe/Tallinn') })
    // Midnight, not the current time — entries are date-only, so an entry
    // planned for today must survive being read at 18:00.
    expect(date.gte.getHours()).toBe(0)
    expect(date.gte.getMinutes()).toBe(0)
    expect(date.gte.getSeconds()).toBe(0)
    expect(date.gte.getMilliseconds()).toBe(0)
  })

  // The bound comes from the household's timezone rather than a bare
  // `new Date()`: two households whose local date differs get different
  // cutoffs for the same instant.
  it('derives the cutoff from the household timezone', async () => {
    vi.useFakeTimers()
    try {
      // 22:30 UTC — already the next day in Auckland, still yesterday in Honolulu.
      vi.setSystemTime(new Date('2026-09-20T22:30:00Z'))

      const tallinn = fakeTx()
      await invalidateFutureEntryTips(tallinn.tx, 'household-123', 'Pacific/Auckland')

      const honolulu = fakeTx()
      await invalidateFutureEntryTips(honolulu.tx, 'household-123', 'Pacific/Honolulu')

      expect(whereOf(tallinn.updateMany).date.gte).not.toEqual(
        whereOf(honolulu.updateMany).date.gte,
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('only touches rows that actually hold a cached value', async () => {
    const { tx, updateMany } = fakeTx()

    await invalidateFutureEntryTips(tx, 'household-123', 'Europe/Tallinn')

    expect(whereOf(updateMany).preparationTips).toEqual({ not: null })
  })
})
