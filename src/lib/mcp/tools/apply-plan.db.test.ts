import { beforeAll, describe, expect, it, vi } from 'vitest'

// `check_plan` and `apply_plan` against PGlite (HON-1652). Only the rate
// limiter is mocked as allowed, because it would call Upstash. The `unit-db`
// project shares one module cache (`isolate: false`), so the tools are
// imported fresh (`beforeAll`), as `fill-plan.db.test.ts` does. Vitest runs in
// UTC, so the household does too, and every date is relative to the real
// today.
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, limit: 5, remaining: 5 }),
}))

import { WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { prisma } from '@/lib/prisma'
import { mcpHousehold, READ_SCOPES, WRITE_SCOPES } from '@/test/mcp'

import type { applyPlan as ApplyPlan } from './apply-plan'
import type { checkPlan as CheckPlan } from './check-plan'

let runTool: typeof import('@/lib/mcp/context').runTool
let applyPlan: typeof ApplyPlan
let checkPlan: typeof CheckPlan

beforeAll(async () => {
  vi.resetModules()
  ;[{ runTool }, { applyPlan }, { checkPlan }] = await Promise.all([
    import('@/lib/mcp/context'),
    import('./apply-plan'),
    import('./check-plan'),
  ])
})

const TIMEZONE = 'UTC'

function day(offset: number): string {
  const date = parseLocalDate(getTodayInTimezone(TIMEZONE))
  date.setDate(date.getDate() + offset)
  return toDateString(date)
}

/**
 * Alder, two members, so a meal without servings cooks for 2. Stew and
 * goulash are beef dinners, soup has no protein, and the cheese bake holds
 * dairy. The pantry ran out of beef.
 */
async function world(preferences: Record<string, unknown> | null = null) {
  const alder = await prisma.household.create({
    data: {
      name: 'Alder',
      locale: 'en',
      timezone: TIMEZONE,
      members: { create: [{ name: 'A' }, { name: 'B' }] },
      mealPlans: { create: { id: 'plan-alder' } },
    },
  })
  const ingredient = (id: string, name: string, data: Record<string, unknown> = {}) =>
    prisma.ingredient.create({
      data: {
        id,
        name,
        category: 'protein',
        defaultUnit: 'g',
        calories: 1,
        protein: 0,
        carbs: 0,
        fat: 0,
        ...data,
      },
    })
  await ingredient('ing-beef', 'glimmer beef')
  await ingredient('ing-cheese', 'glimmer cheese', { allergens: ['dairy'] })
  const meal = (id: string, name: string, data: Record<string, unknown>) =>
    prisma.meal.create({ data: { id, name, suitableFor: ['lunch', 'dinner'], ...data } })
  await meal('stew', 'Glimmer stew', {
    primaryProteinType: 'beef',
    timeMinutes: 90,
    components: { create: { ingredientId: 'ing-beef', quantityPerServing: 100 } },
  })
  await meal('goulash', 'Glimmer goulash', { primaryProteinType: 'beef' })
  await meal('soup', 'Glimmer soup', { primaryProteinType: 'none' })
  await meal('bake', 'Glimmer cheese bake', {
    components: { create: { ingredientId: 'ing-cheese', quantityPerServing: 50 } },
  })
  await prisma.pantryItem.create({
    data: { householdId: alder.id, ingredientId: 'ing-beef', quantity: 0 },
  })
  return mcpHousehold({
    id: alder.id,
    locale: 'en',
    timezone: TIMEZONE,
    preferences: preferences as never,
  })
}

type Household = Awaited<ReturnType<typeof world>>

async function check(household: Household, slots: unknown[]) {
  const result = await runTool(
    checkPlan,
    { userId: 'user-1', household, scopes: READ_SCOPES },
    checkPlan.inputSchema.parse({ slots }),
  )
  return result.structuredContent as Awaited<ReturnType<typeof CheckPlan.run>>
}

async function apply(household: Household, slots: unknown[], restoreToken?: string) {
  const result = await runTool(
    applyPlan,
    { userId: 'user-1', household, scopes: WRITE_SCOPES },
    applyPlan.inputSchema.parse({ slots, restoreToken }),
  )
  return result.structuredContent as Awaited<ReturnType<typeof ApplyPlan.run>>
}

function entry(id: string, date: string, mealType: string, data: Record<string, unknown> = {}) {
  return prisma.mealPlanEntry.create({
    data: { id, planId: 'plan-alder', date: parseLocalDate(date), mealType, ...data } as never,
  })
}

function slotRows(date: string, mealType: string) {
  return prisma.mealPlanEntry.findMany({
    where: { planId: 'plan-alder', date: parseLocalDate(date), mealType: mealType as never },
    include: { items: { orderBy: { position: 'asc' } } },
  })
}

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
})

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

  it('warns of a beef dinner next to a kept beef dinner', async () => {
    const household = await world()
    await entry('kept-stew', day(3), 'dinner', { mealId: 'stew' })

    const result = await check(household, [{ date: day(2), mealType: 'dinner', mealId: 'goulash' }])

    expect(result.warnings.map(({ code }) => code)).toEqual(['sameProteinInARow'])
  })

  it('puts the old week back when applied with its previous, and leaves other slots alone', async () => {
    const household = await world()
    await entry('old-dinner', day(1), 'dinner', { mealId: 'stew', servingOverride: 4 })
    await entry('old-lunch', day(2), 'lunch', {
      kind: 'fridge',
      items: { create: { sourceEntryId: 'old-dinner', servings: 1.5, position: 0 } },
    })
    await entry('kept', day(2), 'dinner', { mealId: 'soup', servingOverride: 3 })

    const applied = await apply(household, [
      { date: day(1), mealType: 'dinner', mealId: 'goulash', servings: 2 },
      { date: day(2), mealType: 'lunch', clear: true },
      { date: day(3), mealType: 'dinner', mealId: 'soup' },
    ])

    expect(applied.outcome).toBe('applied')
    expect(applied.previous).toEqual([
      { date: day(1), mealType: 'dinner', mealId: 'stew', servings: 4 },
      {
        date: day(2),
        mealType: 'lunch',
        items: [{ leftoverOf: { date: day(1), mealType: 'dinner' }, servings: 1.5 }],
      },
      { date: day(3), mealType: 'dinner', clear: true },
    ])
    expect((await slotRows(day(1), 'dinner')).map((row) => row.mealId)).toEqual(['goulash'])
    expect(await slotRows(day(2), 'lunch')).toEqual([])

    const undone = await apply(household, applied.previous!, applied.restoreToken)

    expect(undone.outcome).toBe('applied')
    const [dinner] = await slotRows(day(1), 'dinner')
    expect(dinner).toMatchObject({ mealId: 'stew', servingOverride: 4 })
    const [lunch] = await slotRows(day(2), 'lunch')
    expect(lunch!.items).toEqual([
      expect.objectContaining({ sourceEntryId: dinner!.id, servings: 1.5 }),
    ])
    expect(await slotRows(day(3), 'dinner')).toEqual([])
    expect(await slotRows(day(2), 'dinner')).toEqual([
      expect.objectContaining({ id: 'kept', mealId: 'soup', servingOverride: 3 }),
    ])
  })

  it('puts back a lunch whose dinner was skipped after the link was saved', async () => {
    const household = await world()
    await entry('skipped-dinner', day(1), 'dinner', { mealId: 'stew', status: 'skipped' })
    await entry('old-lunch', day(2), 'lunch', {
      kind: 'fridge',
      items: { create: { sourceEntryId: 'skipped-dinner', servings: 2, position: 0 } },
    })

    const applied = await apply(household, [
      { date: day(2), mealType: 'lunch', items: [{ label: 'Soup from the freezer' }] },
    ])
    const undone = await apply(household, applied.previous!, applied.restoreToken)

    expect(applied.previous).toEqual([
      {
        date: day(2),
        mealType: 'lunch',
        items: [{ sourceEntryId: 'skipped-dinner', servings: 2 }],
      },
    ])
    expect(undone.outcome).toBe('applied')
    const [lunch] = await slotRows(day(2), 'lunch')
    expect(lunch!.items).toEqual([
      expect.objectContaining({ sourceEntryId: 'skipped-dinner', servings: 2 }),
    ])
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

  it("refuses that lunch's link without the token, or with another draft's token", async () => {
    const household = await world()
    await entry('skipped-dinner', day(1), 'dinner', { mealId: 'stew', status: 'skipped' })
    await entry('old-lunch', day(2), 'lunch', {
      kind: 'fridge',
      items: { create: { sourceEntryId: 'skipped-dinner', servings: 2, position: 0 } },
    })
    const applied = await apply(household, [
      { date: day(2), mealType: 'lunch', items: [{ label: 'Soup from the freezer' }] },
    ])
    const changed = [
      {
        date: day(2),
        mealType: 'lunch',
        items: [{ sourceEntryId: 'skipped-dinner', servings: 3 }],
      },
    ]

    const untokened = await apply(household, applied.previous!)
    const forged = await apply(household, changed, applied.restoreToken)

    expect(untokened.problems?.map(({ code }) => code)).toEqual(['skipped'])
    expect(forged.problems?.map(({ code }) => code)).toEqual(['skipped'])
    const [lunch] = await slotRows(day(2), 'lunch')
    expect(lunch!.items).toEqual([expect.objectContaining({ label: 'Soup from the freezer' })])
  })

  it('puts back a lunch whose source became a fridge meal, with the lunch first in the draft', async () => {
    const household = await world()
    await entry('fridge-dinner', day(1), 'dinner', {
      kind: 'fridge',
      items: { create: { label: 'Rice', position: 0 } },
    })
    await entry('old-lunch', day(2), 'lunch', {
      kind: 'fridge',
      items: { create: { sourceEntryId: 'fridge-dinner', servings: 1, position: 0 } },
    })

    const applied = await apply(household, [
      { date: day(2), mealType: 'lunch', items: [{ label: 'Toast' }] },
      { date: day(1), mealType: 'dinner', items: [{ label: 'Pizza' }] },
    ])
    const undone = await apply(household, applied.previous!, applied.restoreToken)

    expect(applied.previous).toEqual([
      {
        date: day(2),
        mealType: 'lunch',
        items: [{ leftoverOf: { date: day(1), mealType: 'dinner' }, servings: 1 }],
      },
      { date: day(1), mealType: 'dinner', items: [{ label: 'Rice' }] },
    ])
    expect(undone.outcome).toBe('applied')
    const [dinner] = await slotRows(day(1), 'dinner')
    const [lunch] = await slotRows(day(2), 'lunch')
    expect(dinner!.items).toEqual([expect.objectContaining({ label: 'Rice' })])
    expect(lunch!.items).toEqual([
      expect.objectContaining({ sourceEntryId: dinner!.id, servings: 1 }),
    ])
  })
})
