import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { loadPlanEntries } from './load-plan-entries'

// The planner read of a fridge meal (HON-1277): what a reload shows. Runs
// against PGlite through the `unit-db` project, with no mocks.

async function world() {
  await prisma.ingredient.create({
    data: {
      id: 'cucumber',
      name: 'Cucumber',
      category: 'vegetable',
      defaultUnit: 'g',
      calories: 15,
      protein: 0,
      carbs: 0,
      fat: 0,
      translations: { create: { locale: 'et', name: 'Kurk' } },
    },
  })
  await prisma.meal.create({
    data: {
      id: 'meal-mash',
      name: 'Mash',
      translations: { create: { locale: 'et', name: 'Kartulipuder' } },
    },
  })
  const alder = await prisma.household.create({
    data: { name: 'Alder', locale: 'et', mealPlans: { create: { id: 'plan-alder' } } },
    include: { _count: { select: { members: true } }, members: { include: { preferences: true } } },
  })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-mash',
      planId: 'plan-alder',
      date: new Date('2026-10-20T00:00:00Z'),
      mealType: 'dinner',
      mealId: 'meal-mash',
      status: 'completed',
    },
  })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-fridge',
      planId: 'plan-alder',
      date: new Date('2026-10-21T00:00:00Z'),
      mealType: 'dinner',
      kind: 'fridge',
      items: {
        create: [
          { position: 1, sourceEntryId: 'entry-mash' },
          { position: 0, ingredientId: 'cucumber' },
          { position: 2, label: 'store meatballs' },
        ],
      },
    },
  })
  return alder
}

describe('loadPlanEntries with a fridge meal', () => {
  it("sends the kind and the items in order, named in the household's language", async () => {
    const household = await world()

    const { entries } = await loadPlanEntries(household, {
      startDate: new Date('2026-10-21T00:00:00Z'),
      endDate: new Date('2026-10-22T00:00:00Z'),
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'fridge', meal: null })
    expect(entries[0]!.items.map(({ id: _id, ...item }) => item)).toEqual([
      {
        ingredientId: 'cucumber',
        sourceEntryId: null,
        label: null,
        name: 'Kurk',
        sourceDate: null,
      },
      {
        ingredientId: null,
        sourceEntryId: 'entry-mash',
        label: null,
        name: 'Kartulipuder',
        sourceDate: '2026-10-20',
      },
      {
        ingredientId: null,
        sourceEntryId: null,
        label: 'store meatballs',
        name: null,
        sourceDate: null,
      },
    ])
  })
})
