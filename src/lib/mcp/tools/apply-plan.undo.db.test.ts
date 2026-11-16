import { beforeAll, describe, expect, it, vi } from 'vitest'

// `apply_plan`'s Undo against PGlite: `previous` and its `restoreToken` (HON-1652).
// Setup and the rate-limit mock: `apply-plan.fixtures.ts`.
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, limit: 5, remaining: 5 }),
}))

import { apply, day, entry, loadTools, slotRows, world } from './apply-plan.fixtures'

beforeAll(loadTools)

describe('apply_plan undo', () => {
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

  it('writes over a lunch saved with one dinner twice, and gives it back once', async () => {
    const household = await world()
    await entry('stored-dinner', day(1), 'dinner', { mealId: 'stew' })
    await entry('old-lunch', day(2), 'lunch', {
      kind: 'fridge',
      items: {
        create: [
          { sourceEntryId: 'stored-dinner', servings: 2, position: 0 },
          { sourceEntryId: 'stored-dinner', servings: 2, position: 1 },
        ],
      },
    })

    const applied = await apply(household, [
      {
        date: day(2),
        mealType: 'lunch',
        items: [{ leftoverOf: { date: day(1), mealType: 'dinner' }, servings: 2 }],
      },
    ])

    expect(applied.outcome).toBe('applied')
    expect(applied.previous).toEqual([
      { date: day(2), mealType: 'lunch', items: [{ sourceEntryId: 'stored-dinner', servings: 2 }] },
    ])
  })
})
