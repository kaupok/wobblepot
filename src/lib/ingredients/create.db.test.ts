import { describe, expect, it, vi } from 'vitest'

import { createHouseholdMeal } from '@/lib/household-meals'
import { createHouseholdIngredient, type NewIngredientInput } from '@/lib/ingredients/create'
import { searchIngredients } from '@/lib/ingredients/search'
import { getCandidates } from '@/lib/meal-planning/candidates'
import { prisma } from '@/lib/prisma'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'

// Runs against PGlite through the `unit-db` project, with no mocks (HON-1263).
// The migrations seed part of the global pool, so a global row a test names is
// found first and added only when the migrations did not seed it.

const lovage: NewIngredientInput = {
  name: '  Lovage  ',
  category: 'vegetable',
  defaultUnit: 'g',
  allergens: [],
  calories: 36,
  protein: 3,
  carbs: 6,
  fat: 0.5,
}

/** The global row named `name`, with an Estonian name when `et` is given. */
async function globalRow(name: string, et?: string) {
  const row =
    (await prisma.ingredient.findFirst({ where: { householdId: null, name } })) ??
    (await prisma.ingredient.create({
      data: {
        name,
        category: 'vegetable',
        defaultUnit: 'g',
        calories: 40,
        protein: 1,
        carbs: 9,
        fat: 0,
      },
    }))
  if (et) {
    await prisma.ingredientTranslation.upsert({
      where: { ingredientId_locale: { ingredientId: row.id, locale: 'et' } },
      create: { ingredientId: row.id, locale: 'et', name: et },
      update: { name: et },
    })
  }
  return row
}

async function world() {
  const alder = await prisma.household.create({ data: { name: 'Alder' } })
  const birch = await prisma.household.create({ data: { name: 'Birch' } })
  return { alder: alder.id, birch: birch.id }
}

const householdRows = (householdId: string) =>
  prisma.ingredient.findMany({ where: { householdId }, select: { id: true, name: true } })

describe('createHouseholdIngredient', () => {
  it('creates a household row with the normalised name and the label values', async () => {
    const { alder } = await world()

    const created = await createHouseholdIngredient(alder, 'en', lovage)

    expect(created).toEqual({
      id: expect.any(String),
      name: 'lovage',
      category: 'vegetable',
      defaultUnit: 'g',
      gramsPerPiece: null,
      measuredByVolume: false,
      calories: 36,
      protein: 3,
      carbs: 6,
      fat: 0.5,
    })
    const row = await prisma.ingredient.findUniqueOrThrow({ where: { id: created.id } })
    expect(row).toMatchObject({ householdId: alder, subcategory: null, proteinType: null })
  })

  it('returns the global row for a global name, and adds no row', async () => {
    const { alder } = await world()
    const onion = await globalRow('onion')

    const result = await createHouseholdIngredient(alder, 'en', { ...lovage, name: 'Onion' })

    expect(result.id).toBe(onion.id)
    expect(await householdRows(alder)).toEqual([])
  })

  it('returns onion for an Estonian household that types "sibul", in its Estonian name', async () => {
    const { alder } = await world()
    const onion = await globalRow('onion', 'sibul')

    const result = await createHouseholdIngredient(alder, 'et', { ...lovage, name: 'Sibul' })

    expect(result).toMatchObject({ id: onion.id, name: 'sibul' })
    expect(await householdRows(alder)).toEqual([])
  })

  it('returns the pool row another English name stands for', async () => {
    const { alder } = await world()
    const flour = await globalRow('plain flour')

    const result = await createHouseholdIngredient(alder, 'en', {
      ...lovage,
      name: 'All-purpose flour',
    })

    expect(result.id).toBe(flour.id)
    expect(await householdRows(alder)).toEqual([])
  })

  it('returns the same household row on a repeat in other case', async () => {
    const { alder } = await world()
    const first = await createHouseholdIngredient(alder, 'en', lovage)

    const again = await createHouseholdIngredient(alder, 'en', { ...lovage, name: 'LOVAGE' })

    expect(again.id).toBe(first.id)
    expect(await householdRows(alder)).toEqual([{ id: first.id, name: 'lovage' }])
  })

  it('keeps the name an Estonian household typed, and its shopping list shows it', async () => {
    // Only `Date` is faked, so "today" is fixed and PGlite's timers still run.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T09:00:00Z'))
    try {
      const household = await prisma.household.create({
        data: {
          name: 'Kask',
          locale: 'et',
          timezone: 'Europe/Tallinn',
          mealPlans: { create: { id: 'plan-kask' } },
        },
      })
      const created = await createHouseholdIngredient(household.id, 'et', {
        ...lovage,
        name: 'Leeskputk',
      })
      const soup = await createHouseholdMeal(household.id, {
        name: 'Leeskputkesupp',
        kidFriendly: true,
        suitableFor: ['dinner'],
        servings: 1,
        components: [{ ingredientId: created.id, totalQuantity: 20 }],
      })
      await prisma.mealPlanEntry.create({
        data: {
          planId: 'plan-kask',
          date: new Date('2026-10-16T00:00:00Z'),
          mealType: 'dinner',
          mealId: soup.id,
          servingOverride: 2,
        },
      })

      const list = await loadShoppingList(household, { days: 7 })

      expect(created.name).toBe('leeskputk')
      expect(list.groups.flatMap((group) => group.items)).toEqual([
        expect.objectContaining({ ingredientId: created.id, name: 'leeskputk', quantity: 40 }),
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it("is found by its own household's search and not by another's", async () => {
    const { alder, birch } = await world()
    const created = await createHouseholdIngredient(alder, 'en', lovage)
    const search = (householdId: string) =>
      searchIngredients({ search: 'lovage', category: null, limit: 10, householdId, locale: 'en' })

    expect((await search(alder)).map((row) => row.id)).toContain(created.id)
    expect((await search(birch)).map((row) => row.id)).not.toContain(created.id)
  })

  it('stores no protein type outside protein, dairy and legume', async () => {
    const { alder } = await world()

    const created = await createHouseholdIngredient(alder, 'en', {
      ...lovage,
      proteinType: 'pork',
    })

    const row = await prisma.ingredient.findUniqueOrThrow({ where: { id: created.id } })
    expect(row.proteinType).toBeNull()
  })

  it('gives a meal with a pork row the pork protein, which a vegetarian plan leaves out', async () => {
    const { alder } = await world()
    const pork = await createHouseholdIngredient(alder, 'en', {
      ...lovage,
      name: 'Kassler',
      category: 'protein',
      proteinType: 'pork',
      calories: 250,
      protein: 20,
      fat: 18,
      carbs: 0,
    })
    const meal = await createHouseholdMeal(alder, {
      name: 'Kassler and potatoes',
      kidFriendly: true,
      suitableFor: ['dinner'],
      servings: 2,
      components: [{ ingredientId: pork.id, totalQuantity: 400 }],
    })
    const candidates = (dietaryType: 'vegetarian' | null) =>
      getCandidates({
        mealType: 'dinner',
        allergensToAvoid: [],
        excludedIngredientIds: [],
        recentMealIds: [],
        dietaryType,
        householdId: alder,
      })

    const row = await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } })
    expect(row.primaryProteinType).toBe('pork')
    expect((await candidates(null)).map((m) => m.id)).toContain(meal.id)
    expect((await candidates('vegetarian')).map((m) => m.id)).not.toContain(meal.id)
  })

  it('keeps a vegan cheese meal in a vegan plan when its protein type is none', async () => {
    const { alder } = await world()
    const cheese = await createHouseholdIngredient(alder, 'en', {
      ...lovage,
      name: 'Vegan cheese',
      category: 'dairy',
      proteinType: 'none',
      calories: 280,
      protein: 2,
      fat: 22,
      carbs: 20,
    })
    const meal = await createHouseholdMeal(alder, {
      name: 'Vegan cheese toastie',
      kidFriendly: true,
      suitableFor: ['lunch'],
      servings: 1,
      components: [{ ingredientId: cheese.id, totalQuantity: 60 }],
    })

    const candidates = await getCandidates({
      mealType: 'lunch',
      allergensToAvoid: [],
      excludedIngredientIds: [],
      recentMealIds: [],
      dietaryType: 'vegan',
      householdId: alder,
    })

    expect(candidates.map((m) => m.id)).toContain(meal.id)
  })
})
