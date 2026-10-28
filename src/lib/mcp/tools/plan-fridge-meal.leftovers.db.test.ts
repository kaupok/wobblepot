import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { planFridgeMeal } from './plan-fridge-meal'
import { call, day, refusal, world } from './plan-fridge-meal.fixtures'

// Runs against PGlite through the `unit-db` project, with no mocks.

// HON-1394: tomorrow's lunch from tonight's dinner, before the dinner is cooked.
describe('plan_fridge_meal with leftovers of a planned meal', () => {
  async function plannedDinner(id: string, date: string, extra: Record<string, unknown> = {}) {
    await prisma.mealPlanEntry.create({
      data: {
        id,
        planId: 'plan-alder',
        date: parseLocalDate(date),
        mealType: 'dinner',
        mealId: 'stew',
        ...extra,
      },
    })
  }

  async function lunchOn(date: string) {
    return prisma.mealPlanEntry.findMany({
      where: { planId: 'plan-alder', date: parseLocalDate(date), mealType: 'lunch' },
      include: { items: { orderBy: { position: 'asc' } } },
    })
  }

  it('plans a lunch from a planned dinner on the day before, with servings 2.5', async () => {
    const household = await world()
    await plannedDinner('entry-tonight', day(0))

    const result = await call(household, {
      date: day(1),
      mealType: 'lunch',
      items: [{ sourceEntryId: 'entry-tonight', servings: 2.5 }],
    })

    expect(result).toMatchObject({ outcome: 'planned', status: 'planned', mealType: 'lunch' })
    expect(result.items).toEqual([
      { name: 'Glimmer stew', source: 'leftover', sourceEntryId: 'entry-tonight', servings: 2.5 },
    ])
    const [lunch] = await lunchOn(day(1))
    expect(lunch!.items).toEqual([
      expect.objectContaining({ sourceEntryId: 'entry-tonight', servings: 2.5 }),
    ])
  })

  it('takes a same-day breakfast, and a planned dinner exactly 3 days before', async () => {
    const household = await world()
    await plannedDinner('entry-three-back', day(1))
    await prisma.mealPlanEntry.create({
      data: {
        id: 'entry-breakfast',
        planId: 'plan-alder',
        date: parseLocalDate(day(4)),
        mealType: 'breakfast',
        mealId: 'stew',
      },
    })

    const result = await call(household, {
      date: day(4),
      mealType: 'lunch',
      items: [
        { sourceEntryId: 'entry-three-back', servings: 1 },
        { sourceEntryId: 'entry-breakfast', servings: 0.5 },
      ],
    })

    expect(result.items.map((item) => item.servings)).toEqual([1, 0.5])
  })

  it.each([
    ['a source after the lunch', 'entry-later', 'an earlier slot'],
    ['a source the same day, later in it', 'entry-same-dinner', 'an earlier slot'],
    ['a source 4 days before the lunch', 'entry-four-back', 'no more than 3 days before'],
    ['a skipped source', 'entry-skipped', 'skipped'],
  ])('refuses %s, with nothing changed', async (_, sourceEntryId, reason) => {
    const household = await world()
    await plannedDinner('entry-later', day(6))
    await plannedDinner('entry-same-dinner', day(5))
    await plannedDinner('entry-four-back', day(1))
    await plannedDinner('entry-skipped', day(4), { status: 'skipped' })

    const message = await refusal(household, {
      date: day(5),
      mealType: 'lunch',
      items: [{ label: 'Bread' }, { sourceEntryId, servings: 2 }],
    })

    expect(message).toContain(reason)
    expect(message).toContain('Nothing was changed.')
    expect(await lunchOn(day(5))).toEqual([])
  })

  it('refuses a planned source with no servings, with nothing changed', async () => {
    const household = await world()
    await plannedDinner('entry-tonight', day(0))
    await prisma.mealPlanEntry.create({
      data: {
        id: 'entry-lunch',
        planId: 'plan-alder',
        date: parseLocalDate(day(1)),
        mealType: 'lunch',
        mealId: 'stew',
      },
    })

    const message = await refusal(household, {
      date: day(1),
      mealType: 'lunch',
      items: [{ sourceEntryId: 'entry-tonight' }],
    })

    expect(message).toContain('give servings')
    const [lunch] = await lunchOn(day(1))
    expect(lunch).toMatchObject({ id: 'entry-lunch', kind: 'meal', mealId: 'stew', items: [] })
  })

  // The dinner keeps its lunches when it is made a fridge meal or skipped, so
  // the lunch's items, sent back as read to add one, must not be refused.
  it.each([
    ['made a fridge meal', { kind: 'fridge', mealId: null }],
    ['skipped', { status: 'skipped' }],
  ] as const)('takes a lunch item back unchanged after its dinner is %s', async (_, change) => {
    const household = await world()
    await plannedDinner('entry-tonight', day(0))
    await call(household, {
      date: day(1),
      mealType: 'lunch',
      items: [{ sourceEntryId: 'entry-tonight', servings: 2.5 }],
    })
    await prisma.mealPlanEntry.update({ where: { id: 'entry-tonight' }, data: change })

    const result = await call(household, {
      date: day(1),
      mealType: 'lunch',
      items: [{ sourceEntryId: 'entry-tonight', servings: 2.5 }, { label: 'Bread' }],
    })

    expect(result.outcome).toBe('replaced')
    const [lunch] = await lunchOn(day(1))
    expect(
      lunch!.items.map(({ sourceEntryId, label, servings }) => ({
        sourceEntryId,
        label,
        servings,
      })),
    ).toEqual([
      { sourceEntryId: 'entry-tonight', label: null, servings: 2.5 },
      { sourceEntryId: null, label: 'Bread', servings: null },
    ])

    // A changed amount is a new link, so the source rule applies again.
    const message = await refusal(household, {
      date: day(1),
      mealType: 'lunch',
      items: [{ sourceEntryId: 'entry-tonight', servings: 3 }],
    })
    expect(message).toContain('Nothing was changed.')
  })

  it.each([0, 0.3, 20.5])('refuses servings of %s before any write', async (servings) => {
    await world()
    await plannedDinner('entry-tonight', day(0))

    const parsed = planFridgeMeal.inputSchema.safeParse({
      date: day(1),
      mealType: 'lunch',
      items: [{ sourceEntryId: 'entry-tonight', servings }],
    })

    expect(parsed.success).toBe(false)
    expect(await lunchOn(day(1))).toEqual([])
  })

  it('takes a cooked source with no servings', async () => {
    const household = await world()

    const result = await call(household, {
      date: day(0),
      mealType: 'lunch',
      items: [{ sourceEntryId: 'entry-cooked' }],
    })

    expect(result.items).toEqual([
      { name: 'Glimmer stew', source: 'leftover', sourceEntryId: 'entry-cooked', servings: null },
    ])
  })
})
