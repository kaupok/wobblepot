import { describe, expect, it } from 'vitest'

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
      imageUrl: 'https://example.com/mash.png',
      imageStatus: 'ready',
      imageHue: 40,
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
        image: null,
        servings: null,
        sourceMealType: null,
        sourceState: null,
      },
      {
        ingredientId: null,
        sourceEntryId: 'entry-mash',
        label: null,
        name: 'Kartulipuder',
        sourceDate: '2026-10-20',
        // The leftovers' meal's picture, so the card shows that dish again.
        image: { imageUrl: 'https://example.com/mash.png', imageStatus: 'ready', imageHue: 40 },
        servings: null,
        sourceMealType: 'dinner',
        sourceState: 'completed',
      },
      {
        ingredientId: null,
        sourceEntryId: null,
        label: 'store meatballs',
        name: null,
        sourceDate: null,
        image: null,
        servings: null,
        sourceMealType: null,
        sourceState: null,
      },
    ])
  })

  // Whether the leftovers will exist (HON-1395): the lunch card says
  // "planned" while its dinner is still to cook, and warns once it is gone.
  it.each([
    ['planned', { status: 'planned' as const }, 'planned'],
    ['skipped', { status: 'skipped' as const }, 'gone'],
    [
      'made a fridge meal',
      { status: 'planned' as const, kind: 'fridge' as const, mealId: null },
      'gone',
    ],
  ])("reports a %s source's state", async (_case, source, state) => {
    const household = await world()
    await prisma.mealPlanEntry.update({ where: { id: 'entry-mash' }, data: source })

    const { entries } = await loadPlanEntries(household, {
      startDate: new Date('2026-10-21T00:00:00Z'),
      endDate: new Date('2026-10-22T00:00:00Z'),
    })

    const leftover = entries[0]!.items.find((item) => item.sourceEntryId === 'entry-mash')
    expect(leftover).toMatchObject({ sourceMealType: 'dinner', sourceState: state })
  })
})
