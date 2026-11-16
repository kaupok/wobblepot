import { beforeAll, describe, expect, it, vi } from 'vitest'

// `check_plan` against PGlite: its problems, warnings and needs (HON-1652).
// Setup and the rate-limit mock: `apply-plan.fixtures.ts`.
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, limit: 5, remaining: 5 }),
}))

import { WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { prisma } from '@/lib/prisma'
import { READ_SCOPES } from '@/test/mcp'

import {
  applyPlan,
  check,
  checkPlan,
  day,
  entry,
  loadTools,
  runTool,
  world,
} from './apply-plan.fixtures'

beforeAll(loadTools)

describe('check_plan', () => {
  it('returns no problems, the week and the needs, and changes nothing', async () => {
    const household = await world()

    const result = await check(household, [
      { date: day(1), mealType: 'dinner', mealId: 'stew', servings: 3 },
    ])

    expect(result.problems).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.week).toHaveLength(1)
    expect(result.week[0]!.slots.find((slot) => slot.mealType === 'dinner')).toMatchObject({
      changed: true,
      entryId: null,
      kind: 'recipe',
      mealName: 'Glimmer stew',
      timeMinutes: 90,
      primaryProteinType: 'beef',
      servings: 3,
      cookServings: 3,
    })
    expect(result.needs).toEqual([
      {
        ingredientId: 'ing-beef',
        name: 'glimmer beef',
        quantity: 300,
        unit: 'g',
        isVague: false,
        phrase: null,
        firstNeededOn: day(1),
        mealCount: 1,
        pantry: { status: 'ranOut', quantity: 0 },
      },
    ])
    expect(await prisma.mealPlanEntry.count()).toBe(0)
  })

  it('runs for a token without mcp:write, which apply_plan refuses', async () => {
    const household = await world()
    const slots = [{ date: day(1), mealType: 'dinner', mealId: 'soup' }]

    const checked = await runTool(
      checkPlan,
      { userId: 'user-1', household, scopes: READ_SCOPES },
      checkPlan.inputSchema.parse({ slots }),
    )
    const applied = await runTool(
      applyPlan,
      { userId: 'user-1', household, scopes: READ_SCOPES },
      applyPlan.inputSchema.parse({ slots }),
    )

    expect(checked.isError).toBeUndefined()
    expect(applied).toEqual({
      isError: true,
      content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
    })
    expect(await prisma.mealPlanEntry.count()).toBe(0)
  })

  it('names a repeated slot, a past day and a day past the window', async () => {
    const household = await world()

    const result = await check(household, [
      { date: day(1), mealType: 'dinner', mealId: 'soup' },
      { date: day(1), mealType: 'dinner', clear: true },
      { date: day(-1), mealType: 'dinner', mealId: 'soup' },
      { date: day(29), mealType: 'dinner', mealId: 'soup' },
    ])

    expect(result.problems.map(({ date, code }) => [date, code])).toEqual([
      [day(1), 'duplicateSlot'],
      [day(-1), 'outOfRange'],
      [day(29), 'outOfRange'],
    ])
  })

  it('returns tooOld for leftovers of a meal 4 days earlier', async () => {
    const household = await world()
    await entry('stored-dinner', day(1), 'dinner', { mealId: 'stew' })

    const result = await check(household, [
      { date: day(2), mealType: 'dinner', mealId: 'soup' },
      { date: day(5), mealType: 'lunch', items: [{ sourceEntryId: 'stored-dinner', servings: 1 }] },
      {
        date: day(6),
        mealType: 'lunch',
        items: [{ leftoverOf: { date: day(2), mealType: 'dinner' }, servings: 1 }],
      },
    ])

    expect(result.problems.map(({ date, code }) => [date, code])).toEqual([
      [day(5), 'tooOld'],
      [day(6), 'tooOld'],
    ])
  })

  it('refuses a replaced dinner whose kept lunch takes its leftovers', async () => {
    const household = await world()
    await entry('stored-dinner', day(1), 'dinner', { mealId: 'stew' })
    await entry('stored-lunch', day(2), 'lunch', {
      kind: 'fridge',
      items: { create: { sourceEntryId: 'stored-dinner', servings: 1, position: 0 } },
    })

    const result = await check(household, [{ date: day(1), mealType: 'dinner', mealId: 'soup' }])

    expect(result.problems.map(({ date, code }) => [date, code])).toEqual([
      [day(1), 'sourceReplaced'],
    ])
  })

  it('warns of a repeated meal and of a replaced meal with a note', async () => {
    const household = await world()
    await entry('noted', day(2), 'dinner', { mealId: 'soup', note: 'Grill outside' })

    const result = await check(household, [
      { date: day(1), mealType: 'lunch', mealId: 'soup' },
      { date: day(2), mealType: 'dinner', mealId: 'soup' },
    ])

    expect(result.problems).toEqual([])
    expect(result.warnings.map(({ code, slots }) => [code, slots])).toEqual([
      [
        'repeatedMeal',
        [
          { date: day(1), mealType: 'lunch' },
          { date: day(2), mealType: 'dinner' },
        ],
      ],
      ['losesChanges', [{ date: day(2), mealType: 'dinner' }]],
    ])
  })

  it('warns of a beef dinner next to a kept beef dinner', async () => {
    const household = await world()
    await entry('kept-stew', day(3), 'dinner', { mealId: 'stew' })

    const result = await check(household, [{ date: day(2), mealType: 'dinner', mealId: 'goulash' }])

    expect(result.warnings.map(({ code }) => code)).toEqual(['sameProteinInARow'])
  })

  it('refuses a new link to a skipped dinner, which only a restore passes', async () => {
    const household = await world()
    await entry('skipped-dinner', day(1), 'dinner', { mealId: 'stew', status: 'skipped' })

    const result = await check(household, [
      {
        date: day(2),
        mealType: 'lunch',
        items: [{ sourceEntryId: 'skipped-dinner', servings: 2 }],
      },
    ])

    expect(result.problems.map(({ code }) => code)).toEqual(['skipped'])
  })

  it('refuses one dinner named twice on a lunch, once by id and once by slot', async () => {
    const household = await world()
    await entry('stored-dinner', day(1), 'dinner', { mealId: 'stew' })

    const result = await check(household, [
      {
        date: day(2),
        mealType: 'lunch',
        items: [
          { sourceEntryId: 'stored-dinner', servings: 1 },
          { leftoverOf: { date: day(1), mealType: 'dinner' }, servings: 1 },
        ],
      },
    ])

    expect(result.problems.map(({ date, code }) => [date, code])).toEqual([
      [day(2), 'duplicateSource'],
    ])
  })

  it('counts the servings a draft lunch adds to a kept dinner on a day the draft does not name', async () => {
    const household = await world()
    await entry('kept-dinner', day(1), 'dinner', { mealId: 'stew', servingOverride: 3 })

    const result = await check(household, [
      {
        date: day(2),
        mealType: 'lunch',
        items: [{ leftoverOf: { date: day(1), mealType: 'dinner' }, servings: 2 }],
      },
    ])

    expect(result.problems).toEqual([])
    expect(
      result.needs.map(({ ingredientId, quantity, firstNeededOn }) => [
        ingredientId,
        quantity,
        firstNeededOn,
      ]),
    ).toEqual([['ing-beef', 200, day(1)]])
  })
})
