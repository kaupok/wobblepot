import { beforeAll, describe, expect, it, vi } from 'vitest'

// `apply_plan` against PGlite: what it writes, and what it refuses to (HON-1652).
// Setup and the rate-limit mock: `apply-plan.fixtures.ts`.
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, limit: 5, remaining: 5 }),
}))

import { parseLocalDate } from '@/lib/meal-planning/dates'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { DraftConflictError, writeDraft } from '@/lib/meal-plans/draft/apply'
import { loadDraftContext } from '@/lib/meal-plans/draft/load'
import { buildView } from '@/lib/meal-plans/draft/view'
import { prisma } from '@/lib/prisma'

import { apply, check, day, entry, loadTools, slotRows, world } from './apply-plan.fixtures'

beforeAll(loadTools)

describe('apply_plan', () => {
  it("writes a lunch from Monday's dinner in the same draft, which cooks for both", async () => {
    const household = await world()

    const result = await apply(household, [
      { date: day(1), mealType: 'dinner', mealId: 'stew', servings: 3 },
      {
        date: day(2),
        mealType: 'lunch',
        items: [{ leftoverOf: { date: day(1), mealType: 'dinner' }, servings: 2 }],
      },
    ])

    expect(result.outcome).toBe('applied')
    expect(
      result.week!.flatMap((day) => day.slots).find((slot) => slot.mealType === 'dinner'),
    ).toMatchObject({ mealId: 'stew', servings: 3, cookServings: 5 })
    const [dinner] = await slotRows(day(1), 'dinner')
    const [lunch] = await slotRows(day(2), 'lunch')
    expect(lunch).toMatchObject({ kind: 'fridge', mealId: null })
    expect(lunch!.items).toEqual([
      expect.objectContaining({ sourceEntryId: dinner!.id, servings: 2 }),
    ])
    const { entries } = await loadPlanEntries(household, {
      startDate: parseLocalDate(day(1)),
      endDate: parseLocalDate(day(2)),
    })
    expect(entries.map((planned) => [planned.meal?.id, planned.cookServings])).toEqual([
      ['stew', 5],
    ])
  })

  it('writes nothing when a meal breaks the household allergens', async () => {
    const household = await world({
      dietaryType: null,
      allergensToAvoid: ['dairy'],
      excludedIngredients: [],
    })
    const slots = [
      { date: day(1), mealType: 'dinner', mealId: 'bake' },
      { date: day(2), mealType: 'dinner', mealId: 'soup' },
    ]

    const checked = await check(household, slots)
    const result = await apply(household, slots)

    expect(checked.problems.map(({ date, code }) => [date, code])).toEqual([[day(1), 'ruledOut']])
    expect(result).toMatchObject({ outcome: 'refused' })
    expect(await prisma.mealPlanEntry.count()).toBe(0)
  })

  it('writes nothing, also to the other slots, when a slot is cooked', async () => {
    const household = await world()
    await entry('cooked', day(0), 'dinner', { mealId: 'stew', status: 'completed' })

    const result = await apply(household, [
      { date: day(0), mealType: 'dinner', mealId: 'soup' },
      { date: day(1), mealType: 'dinner', mealId: 'stew' },
    ])

    expect(result.outcome).toBe('refused')
    expect(result.problems?.map(({ date, code }) => [date, code])).toEqual([[day(0), 'cooked']])
    expect(await slotRows(day(1), 'dinner')).toEqual([])
    expect((await slotRows(day(0), 'dinner')).map((row) => row.mealId)).toEqual(['stew'])
  })

  it('writes two beef dinners in a row, with the warning', async () => {
    const household = await world()

    const result = await apply(household, [
      { date: day(1), mealType: 'dinner', mealId: 'stew' },
      { date: day(2), mealType: 'dinner', mealId: 'goulash' },
    ])

    expect(result.outcome).toBe('applied')
    expect(result.warnings.map(({ code, slots }) => [code, slots])).toEqual([
      [
        'sameProteinInARow',
        [
          { date: day(1), mealType: 'dinner' },
          { date: day(2), mealType: 'dinner' },
        ],
      ],
    ])
    expect(await prisma.mealPlanEntry.count()).toBe(2)
  })

  it('writes nothing when a slot is cooked between the check and the write', async () => {
    const household = await world()
    await entry('dinner', day(0), 'dinner', { mealId: 'stew' })
    await entry('side', day(0), 'dinner', { mealId: 'soup', mainEntryId: 'dinner' })
    const slots = [
      { date: day(0), mealType: 'dinner', clear: true },
      { date: day(1), mealType: 'dinner', mealId: 'soup' },
    ] as const
    const ctx = await loadDraftContext(household, slots)
    await prisma.mealPlanEntry.update({ where: { id: 'dinner' }, data: { status: 'completed' } })

    await expect(writeDraft(ctx, buildView(slots), 'plan-alder')).rejects.toBeInstanceOf(
      DraftConflictError,
    )
    expect((await slotRows(day(0), 'dinner')).map((row) => row.id).sort()).toEqual([
      'dinner',
      'side',
    ])
    expect(await slotRows(day(1), 'dinner')).toEqual([])
  })
})
