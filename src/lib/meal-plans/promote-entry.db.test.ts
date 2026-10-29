import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MealPlanEntryStatus } from '@/generated/prisma/enums'
import { EntryChangeError, type EntryChangeRefusal } from '@/lib/meal-plans/entry-changes'
import { promoteEntry } from '@/lib/meal-plans/promote-entry'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.

const TIPS = JSON.stringify({
  equipment: ['Pot'],
  steps: ['Boil the pasta', 'Stir in the yoghurt'],
  pitfalls: [],
  servings: 2,
})

/**
 * Alder plans the library's cream pasta (100 g pasta, 50 g cream per serving,
 * 4 servings) on Monday and Tuesday, and has favourited it. Monday replaces
 * the cream with 60 g yoghurt and adds 2 g chili. Chicken carries the protein.
 */
async function world() {
  const ingredient = (id: string, extra: object = {}) =>
    prisma.ingredient.create({
      data: {
        id,
        name: id,
        category: 'dairy',
        defaultUnit: 'g',
        calories: 1,
        protein: 0,
        carbs: 0,
        fat: 0,
        ...extra,
      },
    })
  const alder = await prisma.household.create({
    data: { name: 'Alder', mealPlans: { create: { id: 'plan-alder' } } },
  })
  const birch = await prisma.household.create({
    data: { name: 'Birch', mealPlans: { create: { id: 'plan-birch' } } },
  })
  for (const id of ['pasta', 'cream', 'yoghurt', 'chili']) await ingredient(id)
  await ingredient('chicken', { protein: 25, proteinType: 'poultry' })
  await prisma.meal.create({
    data: {
      id: 'meal-pasta',
      name: 'Cream pasta',
      description: 'Quick and creamy',
      preparationNotes: 'Library steps',
      timeMinutes: 20,
      kidFriendly: true,
      suitableFor: ['dinner'],
      servings: 4,
      imageUrl: 'https://blob.example/pasta.png',
      components: {
        create: [
          { ingredientId: 'pasta', quantityPerServing: 100 },
          {
            ingredientId: 'cream',
            quantityPerServing: 50,
            isVague: false,
            originalPhrase: 'a splash',
          },
        ],
      },
      preparationSteps: {
        create: { locale: 'en', servings: 4, steps: '{"steps":["Shared"]}', inputHash: 'h' },
      },
      favoritedBy: { create: { householdId: alder.id } },
    },
  })
  await entry('entry-mon', 'plan-alder', '2026-10-19')
  await entry('entry-tue', 'plan-alder', '2026-10-20')
  await prisma.mealPlanEntry.update({
    where: { id: 'entry-mon' },
    data: { servingOverride: 2, rating: 'up', adjustmentNote: 'No cream, I have yoghurt' },
  })
  await prisma.mealPlanEntryComponent.createMany({
    data: [
      {
        entryId: 'entry-mon',
        originalIngredientId: 'cream',
        replacementIngredientId: 'yoghurt',
        quantityPerServing: 60,
        createdAt: new Date('2026-10-18T10:00:00Z'),
      },
      {
        entryId: 'entry-mon',
        originalIngredientId: null,
        replacementIngredientId: 'chili',
        quantityPerServing: 2,
        createdAt: new Date('2026-10-18T10:00:01Z'),
      },
    ],
  })
  return { alder, birch }
}

function entry(
  id: string,
  planId: string,
  date: string,
  status: MealPlanEntryStatus = 'planned',
  mealId = 'meal-pasta',
) {
  return prisma.mealPlanEntry.create({
    data: {
      id,
      planId,
      date: new Date(`${date}T00:00:00Z`),
      mealType: 'dinner',
      mealId,
      status,
      preparationTips: TIPS,
    },
  })
}

async function refusal(promise: Promise<unknown>): Promise<EntryChangeRefusal> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(EntryChangeError)
  return (error as EntryChangeError).reason
}

const readEntry = (id: string) =>
  prisma.mealPlanEntry.findUniqueOrThrow({ where: { id }, include: { changes: true } })

const componentsOf = async (mealId: string) =>
  (
    await prisma.mealComponent.findMany({
      where: { mealId },
      orderBy: { ingredientId: 'asc' },
      select: { ingredientId: true, quantityPerServing: true, originalPhrase: true },
    })
  ).map((c) => [c.ingredientId, c.quantityPerServing, c.originalPhrase])

describe('promoteEntry on a library meal', () => {
  it('forks a household recipe from the merged list and repoints the entry', async () => {
    const { alder } = await world()

    const result = await promoteEntry(alder.id, 'plan-alder', 'entry-mon', {
      name: 'Cream pasta (my version)',
    })

    expect(result.outcome).toBe('forked')
    const meal = await prisma.meal.findUniqueOrThrow({ where: { id: result.mealId } })
    expect(meal).toMatchObject({
      name: 'Cream pasta (my version)',
      householdId: alder.id,
      description: 'Quick and creamy',
      // The entry's cached steps, one per line; not the library's notes.
      preparationNotes: 'Boil the pasta\nStir in the yoghurt',
      timeMinutes: 20,
      kidFriendly: true,
      suitableFor: ['dinner'],
      servings: 4,
      imageUrl: null,
      primaryProteinType: 'none',
    })
    expect(await componentsOf(result.mealId)).toEqual([
      ['chili', 2, null],
      ['pasta', 100, null],
      ['yoghurt', 60, null],
    ])

    const repointed = await readEntry('entry-mon')
    expect(repointed).toMatchObject({
      mealId: result.mealId,
      preparationTips: null,
      adjustmentNote: null,
      // The same dish, so these stay.
      servingOverride: 2,
      rating: 'up',
    })
    expect(repointed.changes).toEqual([])
  })

  it('leaves the library meal, its favourites and its other entries untouched', async () => {
    const { alder } = await world()

    const { mealId } = await promoteEntry(alder.id, 'plan-alder', 'entry-mon', { name: 'Mine' })

    expect(await componentsOf('meal-pasta')).toEqual([
      ['cream', 50, 'a splash'],
      ['pasta', 100, null],
    ])
    expect(await prisma.favoriteMeal.count({ where: { mealId: 'meal-pasta' } })).toBe(1)
    expect(await prisma.mealPreparationSteps.count({ where: { mealId: 'meal-pasta' } })).toBe(1)
    expect(await readEntry('entry-tue')).toMatchObject({
      mealId: 'meal-pasta',
      preparationTips: TIPS,
    })
    // The new recipe starts with no favourite, rating or shared steps cache.
    expect(await prisma.favoriteMeal.count({ where: { mealId } })).toBe(0)
    expect(await prisma.mealPreparationSteps.count({ where: { mealId } })).toBe(0)
    expect(await prisma.mealPlanEntry.count({ where: { mealId, rating: { not: null } } })).toBe(1)
  })

  it('falls back to the library notes without cached steps, and derives the protein', async () => {
    const { alder } = await world()
    await prisma.mealPlanEntry.update({
      where: { id: 'entry-mon' },
      data: { preparationTips: null },
    })
    await prisma.mealPlanEntryComponent.create({
      data: {
        entryId: 'entry-mon',
        originalIngredientId: null,
        replacementIngredientId: 'chicken',
        quantityPerServing: 150,
      },
    })

    const { mealId } = await promoteEntry(alder.id, 'plan-alder', 'entry-mon', { name: 'Mine' })

    expect(await prisma.meal.findUniqueOrThrow({ where: { id: mealId } })).toMatchObject({
      preparationNotes: 'Library steps',
      primaryProteinType: 'poultry',
    })
  })

  it('refuses a cooked entry and creates no meal', async () => {
    const { alder } = await world()
    await prisma.mealPlanEntry.update({ where: { id: 'entry-mon' }, data: { status: 'completed' } })

    expect(await refusal(promoteEntry(alder.id, 'plan-alder', 'entry-mon', { name: 'x' }))).toBe(
      'notPlanned',
    )
    expect(await prisma.meal.count()).toBe(1)
    expect((await readEntry('entry-mon')).changes).toHaveLength(2)
  })

  it('refuses an entry whose changes are all stale', async () => {
    const { alder } = await world()
    await prisma.mealPlanEntryComponent.deleteMany({ where: { entryId: 'entry-mon' } })
    // The original is not in the meal, so the change does nothing.
    await prisma.mealPlanEntryComponent.create({
      data: { entryId: 'entry-mon', originalIngredientId: 'chili', replacementIngredientId: null },
    })

    expect(await refusal(promoteEntry(alder.id, 'plan-alder', 'entry-mon', { name: 'x' }))).toBe(
      'noChanges',
    )
    expect(await prisma.meal.count()).toBe(1)
  })

  it('refuses a list with every ingredient left out, and creates no meal', async () => {
    const { alder } = await world()
    await prisma.mealPlanEntryComponent.deleteMany({ where: { entryId: 'entry-mon' } })
    await prisma.mealPlanEntryComponent.createMany({
      data: ['pasta', 'cream'].map((id) => ({ entryId: 'entry-mon', originalIngredientId: id })),
    })

    expect(await refusal(promoteEntry(alder.id, 'plan-alder', 'entry-mon', { name: 'x' }))).toBe(
      'invalidRecipe',
    )
    expect(await prisma.meal.count()).toBe(1)
  })

  it("refuses another household's entry", async () => {
    const { birch } = await world()

    expect(await refusal(promoteEntry(birch.id, 'plan-alder', 'entry-mon', { name: 'x' }))).toBe(
      'entryNotFound',
    )
  })

  it('refuses a deleted meal', async () => {
    const { alder } = await world()
    await prisma.meal.update({ where: { id: 'meal-pasta' }, data: { deletedAt: new Date() } })

    expect(await refusal(promoteEntry(alder.id, 'plan-alder', 'entry-mon', { name: 'x' }))).toBe(
      'mealNotFound',
    )
  })
})

describe("promoteEntry on the household's own recipe", () => {
  /** Alder's own "Pasta" recipe, on Monday (changed) and Wednesday. */
  async function ownRecipe() {
    const { alder } = await world()
    await prisma.meal.create({
      data: {
        id: 'meal-own',
        name: 'Pasta',
        householdId: alder.id,
        servings: 2,
        components: {
          create: [
            { ingredientId: 'pasta', quantityPerServing: 100 },
            { ingredientId: 'cream', quantityPerServing: 50 },
          ],
        },
      },
    })
    await prisma.mealPlanEntry.update({ where: { id: 'entry-mon' }, data: { mealId: 'meal-own' } })
    await entry('entry-wed', 'plan-alder', '2026-10-21', 'planned', 'meal-own')
    return { alder }
  }

  it('writes the merged list into the recipe and clears the entry', async () => {
    const { alder } = await ownRecipe()

    const result = await promoteEntry(alder.id, 'plan-alder', 'entry-mon', { name: 'ignored' })

    expect(result).toEqual({ outcome: 'updated', mealId: 'meal-own' })
    expect(await prisma.meal.findUniqueOrThrow({ where: { id: 'meal-own' } })).toMatchObject({
      name: 'Pasta',
    })
    expect(await componentsOf('meal-own')).toEqual([
      ['chili', 2, null],
      ['pasta', 100, null],
      ['yoghurt', 60, null],
    ])
    expect(await readEntry('entry-mon')).toMatchObject({
      mealId: 'meal-own',
      preparationTips: null,
      adjustmentNote: null,
      changes: [],
    })
    // Another planned entry of the recipe now cooks the new list, so its
    // steps go.
    expect(await readEntry('entry-wed')).toMatchObject({ preparationTips: null })
    expect(await prisma.meal.count()).toBe(2)
  })

  it('keeps a chosen main protein while its ingredient stays (HON-1386)', async () => {
    const { alder } = await ownRecipe()
    // 200 g beans give 18 g protein against 12.5 g from 50 g chicken, so the
    // recipe derives Legumes; the household chose Poultry.
    await prisma.ingredient.create({
      data: {
        id: 'beans',
        name: 'beans',
        category: 'legume',
        defaultUnit: 'g',
        calories: 1,
        protein: 9,
        carbs: 0,
        fat: 0,
        proteinType: 'legume',
      },
    })
    await prisma.mealComponent.createMany({
      data: [
        { mealId: 'meal-own', ingredientId: 'chicken', quantityPerServing: 50 },
        { mealId: 'meal-own', ingredientId: 'beans', quantityPerServing: 200 },
      ],
    })
    await prisma.meal.update({
      where: { id: 'meal-own' },
      data: { primaryProteinType: 'poultry', proteinTypeOverride: 'poultry' },
    })

    await promoteEntry(alder.id, 'plan-alder', 'entry-mon', { name: 'ignored' })

    expect(
      await prisma.meal.findUniqueOrThrow({
        where: { id: 'meal-own' },
        select: { primaryProteinType: true, proteinTypeOverride: true },
      }),
    ).toEqual({ primaryProteinType: 'poultry', proteinTypeOverride: 'poultry' })
  })

  it('refuses when a change is undone after the read, and leaves the recipe as it was', async () => {
    const { alder } = await ownRecipe()
    // Another member taps Undo on the chili between the read and the write.
    const read = prisma.mealPlanEntry.findUniqueOrThrow.bind(prisma.mealPlanEntry)
    vi.spyOn(prisma.mealPlanEntry, 'findUniqueOrThrow').mockImplementationOnce(((
      args: Parameters<typeof read>[0],
    ) =>
      read(args).then(async (row) => {
        await prisma.mealPlanEntryComponent.deleteMany({
          where: { entryId: 'entry-mon', replacementIngredientId: 'chili' },
        })
        return row
      })) as never)

    expect(await refusal(promoteEntry(alder.id, 'plan-alder', 'entry-mon', { name: 'x' }))).toBe(
      'changesMoved',
    )
    expect(await componentsOf('meal-own')).toEqual([
      ['cream', 50, null],
      ['pasta', 100, null],
    ])
  })

  it('refuses an ingredient the household can no longer see, and leaves the recipe as it was', async () => {
    const { alder } = await ownRecipe()
    const birch = await prisma.household.findFirstOrThrow({ where: { name: 'Birch' } })
    await prisma.ingredient.update({ where: { id: 'chili' }, data: { householdId: birch.id } })

    expect(await refusal(promoteEntry(alder.id, 'plan-alder', 'entry-mon', { name: 'x' }))).toBe(
      'ingredientNotFound',
    )
    expect(await componentsOf('meal-own')).toEqual([
      ['cream', 50, null],
      ['pasta', 100, null],
    ])
    expect((await readEntry('entry-mon')).changes).toHaveLength(2)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
