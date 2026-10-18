import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { loadPlanEntries } from './load-plan-entries'
import { addEntryChange } from '@/lib/meal-plans/entry-changes'

// The planner read with an entry's own ingredient changes (HON-1243). Runs
// against PGlite through the `unit-db` project, with no mocks.

/**
 * Alder (Estonian, avoids dairy) plans a pasta bake on two days. Cream is
 * dairy and 300 kcal per 100 g; yoghurt is dairy-free here and 60 kcal; pasta
 * 350 kcal. Per serving: 100 g pasta, 50 g cream.
 */
async function world() {
  const ingredient = (id: string, calories: number, allergens: 'dairy'[] = [], et?: string) =>
    prisma.ingredient.create({
      data: {
        id,
        name: id,
        category: 'dairy',
        defaultUnit: 'g',
        allergens,
        calories,
        protein: 0,
        carbs: 0,
        fat: 0,
        ...(et && { translations: { create: { locale: 'et', name: et } } }),
      },
    })
  await ingredient('pasta', 350)
  await ingredient('cream', 300, ['dairy'], 'Koor')
  await ingredient('silken tofu', 150, [], 'Siidine tofu')
  await ingredient('mushroom', 20)
  const alder = await prisma.household.create({
    data: {
      name: 'Alder',
      locale: 'et',
      mealPlans: { create: { id: 'plan-alder' } },
    },
    include: { _count: { select: { members: true } }, members: { include: { preferences: true } } },
  })
  await prisma.meal.create({
    data: {
      id: 'meal-pasta',
      name: 'Pasta bake',
      components: {
        create: [
          { ingredientId: 'pasta', quantityPerServing: 100 },
          { ingredientId: 'cream', quantityPerServing: 50 },
          { ingredientId: 'mushroom', quantityPerServing: 40 },
        ],
      },
    },
  })
  for (const [id, day] of [
    ['entry-mon', '19'],
    ['entry-tue', '20'],
  ]) {
    await prisma.mealPlanEntry.create({
      data: {
        id: id!,
        planId: 'plan-alder',
        date: new Date(`2026-10-${day}T00:00:00Z`),
        mealType: 'dinner',
        mealId: 'meal-pasta',
      },
    })
  }
  return {
    ...alder,
    preferences: {
      dietaryType: null,
      allergensToAvoid: ['dairy' as const],
      excludedIngredients: [],
      excludedIngredientIds: [],
    },
  }
}

const QUERY = {
  startDate: new Date('2026-10-19T00:00:00Z'),
  endDate: new Date('2026-10-21T00:00:00Z'),
}

const change = (
  householdId: string,
  originalIngredientId: string | null,
  replacementIngredientId: string | null,
  quantityPerServing: number | null,
) =>
  addEntryChange(householdId, 'plan-alder', 'entry-mon', {
    originalIngredientId,
    replacementIngredientId,
    quantityPerServing,
  })

async function read(household: Awaited<ReturnType<typeof world>>) {
  const { entries } = await loadPlanEntries(household, QUERY)
  return Object.fromEntries(entries.map((e) => [e.id, e]))
}

describe('loadPlanEntries with ingredient changes', () => {
  it('sends the merged components, nutrition and conflicts for the changed entry only', async () => {
    const household = await world()
    await change(household.id, 'cream', 'silken tofu', 60)
    await change(household.id, 'mushroom', null, null)

    const { 'entry-mon': mon, 'entry-tue': tue } = await read(household)

    expect(mon!.meal!.components.map((c) => [c.ingredientId, c.quantityPerServing])).toEqual([
      ['pasta', 100],
      ['silken tofu', 60],
    ])
    // 350 + 0.6 × 150 = 440 kcal; the dairy cream is gone, so no conflict.
    expect(mon!.meal!.nutrition.calories).toBeCloseTo(440)
    expect(mon!.conflicts).toEqual([])
    // The other entry of the same meal keeps the recipe: 350 + 150 + 8.
    expect(tue!.meal!.components.map((c) => c.ingredientId)).toEqual(['pasta', 'cream', 'mushroom'])
    expect(tue!.meal!.nutrition.calories).toBeCloseTo(508)
    expect(tue!.conflicts).toEqual([{ kind: 'allergen', constraint: 'dairy' }])
    expect(tue!.changes).toEqual([])
  })

  it('lists the changes with translated names, oldest first', async () => {
    const household = await world()
    await change(household.id, 'cream', 'silken tofu', 60)
    await change(household.id, 'mushroom', null, null)

    const { 'entry-mon': mon } = await read(household)

    expect(mon!.changes).toEqual([
      {
        id: expect.any(String),
        original: { id: 'cream', name: 'Koor' },
        replacement: { id: 'silken tofu', name: 'Siidine tofu' },
        quantityPerServing: 60,
        stale: false,
      },
      {
        id: expect.any(String),
        original: { id: 'mushroom', name: 'mushroom' },
        replacement: null,
        quantityPerServing: null,
        stale: false,
      },
    ])
    expect(mon!.meal!.components[1]!.ingredient.name).toBe('Siidine tofu')
  })

  it('marks a change stale once the recipe drops its original, and ignores it', async () => {
    const household = await world()
    await change(household.id, 'cream', 'silken tofu', 60)
    await prisma.mealComponent.deleteMany({
      where: { mealId: 'meal-pasta', ingredientId: 'cream' },
    })

    const { 'entry-mon': mon } = await read(household)

    expect(mon!.changes.map((c) => c.stale)).toEqual([true])
    expect(mon!.meal!.components.map((c) => c.ingredientId)).toEqual(['pasta', 'mushroom'])
  })
})
