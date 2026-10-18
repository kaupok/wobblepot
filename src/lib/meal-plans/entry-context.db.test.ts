import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  cachePreparationTips,
  EntryContextError,
  loadEntryForAi,
  loadPantryNamesForAi,
  type PricedFrom,
} from '@/lib/meal-plans/entry-context'

// Runs against PGlite through the `unit-db` project, with no mocks: rows are
// written with Prisma and read or changed through the lib functions (HON-1207).

async function ingredient(id: string, name: string, et?: string) {
  await prisma.ingredient.create({
    data: {
      id,
      name,
      category: 'spice',
      defaultUnit: 'g',
      calories: 1,
      protein: 0,
      carbs: 0,
      fat: 0,
      ...(et && { translations: { create: { locale: 'et', name: et } } }),
    },
  })
}

/**
 * Alder (Estonian) has a chicken dinner with an Estonian translation and an
 * empty lunch. Birch has its own plan and entry. Each has a pantry.
 */
async function world() {
  await ingredient('ing-chicken', 'Chicken breast', 'Kanarind')
  await ingredient('ing-rice', 'Rice', 'Riis')
  await ingredient('ing-salt', 'Salt', 'Sool')
  await ingredient('ing-yoghurt', 'Yoghurt')
  await prisma.meal.create({
    data: {
      id: 'meal-chicken',
      name: 'Chicken stir fry',
      timeMinutes: 30,
      preparationNotes: 'Sear first.',
      components: { create: { ingredientId: 'ing-chicken', quantityPerServing: 150 } },
      translations: {
        create: { locale: 'et', name: 'Kana wokipannil', preparationNotes: 'Pruunista.' },
      },
    },
  })
  const alder = await prisma.household.create({
    data: { name: 'Alder', locale: 'et', mealPlans: { create: { id: 'plan-alder' } } },
  })
  const birch = await prisma.household.create({
    data: { name: 'Birch', mealPlans: { create: { id: 'plan-birch' } } },
  })
  const date = new Date('2026-10-15T00:00:00Z')
  await prisma.mealPlanEntry.createMany({
    data: [
      {
        id: 'entry-dinner',
        planId: 'plan-alder',
        date,
        mealType: 'dinner',
        mealId: 'meal-chicken',
        servingOverride: 6,
      },
      { id: 'entry-lunch', planId: 'plan-alder', date, mealType: 'lunch' },
      { id: 'entry-birch', planId: 'plan-birch', date, mealType: 'dinner' },
    ],
  })
  return { alder, birch }
}

describe('loadEntryForAi', () => {
  it('returns the entry with its meal, components and ingredients, in English', async () => {
    const { alder } = await world()

    const entry = await loadEntryForAi(alder.id, 'plan-alder', 'entry-dinner', 'en')

    expect(entry).toMatchObject({
      id: 'entry-dinner',
      planId: 'plan-alder',
      mealId: 'meal-chicken',
      servingOverride: 6,
      preparationTips: null,
      meal: {
        id: 'meal-chicken',
        name: 'Chicken stir fry',
        timeMinutes: 30,
        preparationNotes: 'Sear first.',
        updatedAt: expect.any(Date),
        components: [
          {
            quantityPerServing: 150,
            ingredient: { name: 'Chicken breast', defaultUnit: 'g', measuredByVolume: false },
          },
        ],
      },
    })
    // English is the base row: no translation rows are read.
    expect(entry.meal).not.toHaveProperty('translations')
    expect(entry.meal!.components[0]!.ingredient).not.toHaveProperty('translations')
  })

  it("reads the locale's translation rows for the meal and its ingredients", async () => {
    const { alder } = await world()

    const entry = await loadEntryForAi(alder.id, 'plan-alder', 'entry-dinner', 'et')

    expect(entry.meal).toMatchObject({
      translations: [{ locale: 'et', name: 'Kana wokipannil', preparationNotes: 'Pruunista.' }],
      components: [{ ingredient: { translations: [{ locale: 'et', name: 'Kanarind' }] } }],
    })
  })

  it("merges the entry's own ingredient changes into components, leaving the meal's", async () => {
    const { alder } = await world()
    await prisma.mealPlanEntryComponent.create({
      data: {
        entryId: 'entry-dinner',
        originalIngredientId: 'ing-chicken',
        replacementIngredientId: 'ing-yoghurt',
        quantityPerServing: 120,
      },
    })

    const entry = await loadEntryForAi(alder.id, 'plan-alder', 'entry-dinner', 'en')

    expect(entry.components).toEqual([
      {
        ingredientId: 'ing-yoghurt',
        quantityPerServing: 120,
        isVague: false,
        originalPhrase: null,
        ingredient: { name: 'Yoghurt', defaultUnit: 'g', measuredByVolume: false },
      },
    ])
    expect(entry.meal!.components.map((c) => c.ingredientId)).toEqual(['ing-chicken'])
  })

  it('returns an empty slot with no meal', async () => {
    const { alder } = await world()

    expect(await loadEntryForAi(alder.id, 'plan-alder', 'entry-lunch', 'en')).toMatchObject({
      id: 'entry-lunch',
      mealId: null,
      meal: null,
    })
  })

  it("refuses another household's entry as not_found", async () => {
    const { alder, birch } = await world()

    await expect(loadEntryForAi(alder.id, 'plan-birch', 'entry-birch', 'en')).rejects.toEqual(
      new EntryContextError('not_found'),
    )
    await expect(loadEntryForAi(birch.id, 'plan-alder', 'entry-dinner', 'en')).rejects.toEqual(
      new EntryContextError('not_found'),
    )
  })

  // The household and the entry match, so only the plan filter refuses it.
  it('refuses as not_found when the URL names a plan the entry is not in', async () => {
    const { alder } = await world()

    const error = await loadEntryForAi(alder.id, 'plan-birch', 'entry-dinner', 'en').catch(
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(EntryContextError)
    expect((error as EntryContextError).reason).toBe('not_found')
  })
})

describe('loadPantryNamesForAi', () => {
  async function pantry() {
    const { alder, birch } = await world()
    await prisma.pantryItem.createMany({
      data: [
        // In stock: a quantity left.
        { householdId: alder.id, ingredientId: 'ing-rice', quantity: 500 },
        // In stock: a staple, even at 0.
        { householdId: alder.id, ingredientId: 'ing-salt', quantity: 0, isStaple: true },
        // In stock: no quantity recorded.
        { householdId: alder.id, ingredientId: 'ing-yoghurt', quantity: null },
        // Ran out.
        { householdId: alder.id, ingredientId: 'ing-chicken', quantity: 0 },
        // Another household's.
        { householdId: birch.id, ingredientId: 'ing-chicken', quantity: 300 },
      ],
    })
    return { alder, birch }
  }

  it('returns the in-stock items by name, without quantities', async () => {
    const { alder } = await pantry()

    expect(await loadPantryNamesForAi(alder.id, 'en')).toEqual([
      { isStaple: false, ingredient: { name: 'Rice' } },
      { isStaple: true, ingredient: { name: 'Salt' } },
      { isStaple: false, ingredient: { name: 'Yoghurt' } },
    ])
  })

  it("reads the locale's ingredient names", async () => {
    const { alder } = await pantry()

    expect(await loadPantryNamesForAi(alder.id, 'et')).toEqual([
      {
        isStaple: false,
        ingredient: { name: 'Rice', translations: [{ locale: 'et', name: 'Riis' }] },
      },
      {
        isStaple: true,
        ingredient: { name: 'Salt', translations: [{ locale: 'et', name: 'Sool' }] },
      },
      { isStaple: false, ingredient: { name: 'Yoghurt', translations: [] } },
    ])
  })

  it("reads only the household's own pantry", async () => {
    const { birch } = await pantry()

    expect(await loadPantryNamesForAi(birch.id, 'en')).toEqual([
      { isStaple: false, ingredient: { name: 'Chicken breast' } },
    ])
  })
})

describe('cachePreparationTips', () => {
  const TIPS = { equipment: ['Wok'], steps: ['Sear'], pitfalls: ['Crowding'], tip: 'Rest it' }

  /** The inputs as the route read them before its AI call. */
  async function pricedFrom(): Promise<PricedFrom> {
    await world()
    const meal = await prisma.meal.findUniqueOrThrow({ where: { id: 'meal-chicken' } })
    return {
      entryId: 'entry-dinner',
      mealId: 'meal-chicken',
      servingOverride: 6,
      mealUpdatedAt: meal.updatedAt,
      householdLocale: 'et',
      changes: [],
      adjustmentNote: null,
    }
  }

  async function storedTips() {
    const entry = await prisma.mealPlanEntry.findUniqueOrThrow({ where: { id: 'entry-dinner' } })
    return entry.preparationTips
  }

  it('caches the tips with the servings they were priced at when every input holds', async () => {
    const inputs = await pricedFrom()

    expect(await cachePreparationTips(inputs, TIPS, 6)).toBe(1)
    expect(JSON.parse((await storedTips())!)).toEqual({ ...TIPS, servings: 6 })
  })

  it('writes nothing when the meal was swapped', async () => {
    const inputs = await pricedFrom()
    await prisma.meal.create({ data: { id: 'meal-other', name: 'Soup' } })
    await prisma.mealPlanEntry.update({
      where: { id: 'entry-dinner' },
      data: { mealId: 'meal-other' },
    })

    expect(await cachePreparationTips(inputs, TIPS, 6)).toBe(0)
    expect(await storedTips()).toBeNull()
  })

  it('writes nothing when the serving override moved', async () => {
    const inputs = await pricedFrom()
    await prisma.mealPlanEntry.update({
      where: { id: 'entry-dinner' },
      data: { servingOverride: 2 },
    })

    expect(await cachePreparationTips(inputs, TIPS, 6)).toBe(0)
    expect(await storedTips()).toBeNull()
  })

  it("writes nothing when the household's locale moved", async () => {
    const inputs = await pricedFrom()
    await prisma.household.updateMany({ where: { name: 'Alder' }, data: { locale: 'en' } })

    expect(await cachePreparationTips(inputs, TIPS, 6)).toBe(0)
    expect(await storedTips()).toBeNull()
  })

  it("writes nothing when the entry's adjustment instruction moved", async () => {
    const inputs = await pricedFrom()
    await prisma.mealPlanEntry.update({
      where: { id: 'entry-dinner' },
      data: { adjustmentNote: 'Less salt' },
    })

    expect(await cachePreparationTips(inputs, TIPS, 6)).toBe(0)
    expect(await storedTips()).toBeNull()
  })

  it("writes nothing when the entry's ingredient changes moved", async () => {
    const inputs = await pricedFrom()
    await prisma.mealPlanEntryComponent.create({
      data: { entryId: 'entry-dinner', originalIngredientId: 'ing-chicken' },
    })

    expect(await cachePreparationTips(inputs, TIPS, 6)).toBe(0)
    expect(await storedTips()).toBeNull()
  })

  it('caches the tips when the changes are the ones the prompt merged', async () => {
    const inputs = await pricedFrom()
    const change = await prisma.mealPlanEntryComponent.create({
      data: { entryId: 'entry-dinner', originalIngredientId: 'ing-chicken' },
    })

    expect(await cachePreparationTips({ ...inputs, changes: [change] }, TIPS, 6)).toBe(1)
    expect(JSON.parse((await storedTips())!)).toEqual({ ...TIPS, servings: 6 })
  })

  it('writes nothing when the meal was edited', async () => {
    const inputs = await pricedFrom()
    await prisma.meal.update({
      where: { id: 'meal-chicken' },
      data: { updatedAt: new Date(inputs.mealUpdatedAt.getTime() + 1000) },
    })

    expect(await cachePreparationTips(inputs, TIPS, 6)).toBe(0)
    expect(await storedTips()).toBeNull()
  })
})
