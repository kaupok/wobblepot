import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createHouseholdIngredient, type NewIngredientInput } from '@/lib/ingredients/create'
import {
  deleteHouseholdIngredient,
  listHouseholdIngredients,
  updateHouseholdIngredient,
} from '@/lib/ingredients/manage'
import { createHouseholdMeal, deleteHouseholdMeal } from '@/lib/household-meals'
import { getCandidates } from '@/lib/meal-planning/candidates'

// Runs against PGlite through the `unit-db` project, with no mocks (HON-1264).

const lovage: NewIngredientInput = {
  name: 'Lovage',
  category: 'vegetable',
  defaultUnit: 'g',
  allergens: [],
  calories: 36,
  protein: 3,
  carbs: 6,
  fat: 0.5,
}

async function world() {
  const alder = await prisma.household.create({ data: { name: 'Alder' } })
  const birch = await prisma.household.create({ data: { name: 'Birch' } })
  return { alder: alder.id, birch: birch.id }
}

async function globalRow(name: string) {
  return (
    (await prisma.ingredient.findFirst({ where: { householdId: null, name } })) ??
    prisma.ingredient.create({
      data: {
        name,
        category: 'vegetable',
        defaultUnit: 'g',
        calories: 40,
        protein: 1,
        carbs: 9,
        fat: 0,
      },
    })
  )
}

const mealWith = (householdId: string, ingredientId: string, name = 'Lovage soup') =>
  createHouseholdMeal(householdId, {
    name,
    kidFriendly: true,
    suitableFor: ['dinner'],
    servings: 2,
    components: [{ ingredientId, totalQuantity: 400 }],
  })

/** A meal plan entry that uses the meal, as a past plan keeps it after the recipe is deleted. */
async function planEntryFor(householdId: string, mealId: string) {
  const plan = await prisma.mealPlan.create({ data: { householdId } })
  await prisma.mealPlanEntry.create({
    data: { planId: plan.id, mealId, date: new Date('2026-10-20'), mealType: 'dinner' },
  })
}

describe('listHouseholdIngredients', () => {
  it("lists the household's rows by name, and no global or other household's row", async () => {
    const { alder, birch } = await world()
    await createHouseholdIngredient(alder, 'en', { ...lovage, name: 'Sorrel', fiber: 3 })
    await createHouseholdIngredient(alder, 'en', { ...lovage, allergens: ['sesame'] })
    await createHouseholdIngredient(birch, 'en', { ...lovage, name: 'Ramsons' })
    await globalRow('onion')

    const rows = await listHouseholdIngredients(alder)

    expect(rows.map((row) => row.name)).toEqual(['lovage', 'sorrel'])
    expect(rows[1]).toEqual({
      id: expect.any(String),
      name: 'sorrel',
      category: 'vegetable',
      proteinType: null,
      defaultUnit: 'g',
      gramsPerPiece: null,
      allergens: [],
      calories: 36,
      protein: 3,
      carbs: 6,
      fat: 0.5,
      fiber: 3,
    })
  })
})

describe('updateHouseholdIngredient', () => {
  it('saves the normalised values', async () => {
    const { alder } = await world()
    const row = await createHouseholdIngredient(alder, 'en', lovage)

    const result = await updateHouseholdIngredient(alder, 'en', row.id, {
      ...lovage,
      name: '  Wild   Lovage ',
      category: 'legume',
      proteinType: 'legume',
      defaultUnit: 'g',
      gramsPerPiece: 30,
      allergens: ['soy', 'soy'],
      calories: 50,
    })

    expect(result).toEqual({
      status: 'updated',
      ingredient: expect.objectContaining({
        id: row.id,
        name: 'wild lovage',
        category: 'legume',
        proteinType: 'legume',
        gramsPerPiece: null,
        allergens: ['soy'],
        calories: 50,
      }),
    })
  })

  it('drops a protein type the new category does not carry', async () => {
    const { alder } = await world()
    const row = await createHouseholdIngredient(alder, 'en', {
      ...lovage,
      category: 'protein',
      proteinType: 'pork',
    })

    await updateHouseholdIngredient(alder, 'en', row.id, { ...lovage, proteinType: 'pork' })

    const saved = await prisma.ingredient.findUniqueOrThrow({ where: { id: row.id } })
    expect(saved.proteinType).toBeNull()
  })

  it('saves an unchanged name without finding the row itself', async () => {
    const { alder } = await world()
    const row = await createHouseholdIngredient(alder, 'en', lovage)

    const result = await updateHouseholdIngredient(alder, 'en', row.id, {
      ...lovage,
      name: 'LOVAGE',
    })

    expect(result.status).toBe('updated')
  })

  it('refuses a rename to a global name with name_taken', async () => {
    const { alder } = await world()
    await globalRow('onion')
    const row = await createHouseholdIngredient(alder, 'en', lovage)

    const result = await updateHouseholdIngredient(alder, 'en', row.id, {
      ...lovage,
      name: 'Onion',
    })

    expect(result).toEqual({ status: 'name_taken' })
    const saved = await prisma.ingredient.findUniqueOrThrow({ where: { id: row.id } })
    expect(saved.name).toBe('lovage')
  })

  it("refuses a rename to another of the household's rows with name_taken", async () => {
    const { alder } = await world()
    await createHouseholdIngredient(alder, 'en', { ...lovage, name: 'Sorrel' })
    const row = await createHouseholdIngredient(alder, 'en', lovage)

    const result = await updateHouseholdIngredient(alder, 'en', row.id, {
      ...lovage,
      name: 'sorrel',
    })

    expect(result).toEqual({ status: 'name_taken' })
  })

  it("allows a rename to another household's row name", async () => {
    const { alder, birch } = await world()
    await createHouseholdIngredient(birch, 'en', { ...lovage, name: 'Sorrel' })
    const row = await createHouseholdIngredient(alder, 'en', lovage)

    const result = await updateHouseholdIngredient(alder, 'en', row.id, {
      ...lovage,
      name: 'Sorrel',
    })

    expect(result.status).toBe('updated')
  })

  it("returns not_found for another household's row and for a global row", async () => {
    const { alder, birch } = await world()
    const theirs = await createHouseholdIngredient(birch, 'en', lovage)
    const onion = await globalRow('onion')

    expect(await updateHouseholdIngredient(alder, 'en', theirs.id, lovage)).toEqual({
      status: 'not_found',
    })
    expect(await updateHouseholdIngredient(alder, 'en', onion.id, lovage)).toEqual({
      status: 'not_found',
    })
    const saved = await prisma.ingredient.findUniqueOrThrow({ where: { id: onion.id } })
    expect(saved.name).toBe('onion')
  })

  it('refuses a unit change on a row a meal uses with unit_locked', async () => {
    const { alder } = await world()
    const row = await createHouseholdIngredient(alder, 'en', lovage)
    await mealWith(alder, row.id)

    const result = await updateHouseholdIngredient(alder, 'en', row.id, {
      ...lovage,
      defaultUnit: 'piece',
      gramsPerPiece: 20,
    })

    expect(result).toEqual({
      status: 'unit_locked',
      uses: { meals: 1, deletedMealsInPlan: 0, pantry: 0, shoppingList: 0, mealPlan: 0, extras: 0 },
    })
  })

  it('keeps the unit locked while a deleted recipe uses the row, so a restore stays valid', async () => {
    const { alder } = await world()
    const row = await createHouseholdIngredient(alder, 'en', lovage)
    const meal = await mealWith(alder, row.id)
    await deleteHouseholdMeal(alder, meal.id)

    const result = await updateHouseholdIngredient(alder, 'en', row.id, {
      ...lovage,
      defaultUnit: 'piece',
      gramsPerPiece: 20,
    })

    expect(result).toMatchObject({ status: 'unit_locked' })
  })

  it('allows a unit change on a row nothing uses', async () => {
    const { alder } = await world()
    const row = await createHouseholdIngredient(alder, 'en', lovage)

    const result = await updateHouseholdIngredient(alder, 'en', row.id, {
      ...lovage,
      defaultUnit: 'piece',
      gramsPerPiece: 20,
    })

    expect(result).toMatchObject({
      status: 'updated',
      ingredient: { defaultUnit: 'piece', gramsPerPiece: 20 },
    })
  })

  it('takes a meal out of a gluten-free plan once its row gains gluten', async () => {
    const { alder } = await world()
    const row = await createHouseholdIngredient(alder, 'en', { ...lovage, name: 'Spelt pasta' })
    const meal = await mealWith(alder, row.id, 'Spelt pasta bake')
    const glutenFree = async () =>
      (
        await getCandidates({
          mealType: 'dinner',
          allergensToAvoid: ['gluten'],
          excludedIngredientIds: [],
          recentMealIds: [],
          householdId: alder,
        })
      ).map((m) => m.id)
    expect(await glutenFree()).toContain(meal.id)

    await updateHouseholdIngredient(alder, 'en', row.id, {
      ...lovage,
      name: 'Spelt pasta',
      allergens: ['gluten'],
    })

    expect(await glutenFree()).not.toContain(meal.id)
  })

  it("re-derives the meal's protein type, so a vegetarian plan leaves the meal out", async () => {
    const { alder } = await world()
    const row = await createHouseholdIngredient(alder, 'en', {
      ...lovage,
      name: 'Kassler',
      category: 'legume',
      proteinType: 'legume',
      protein: 20,
    })
    const meal = await mealWith(alder, row.id, 'Kassler and potatoes')
    const vegetarian = async () =>
      (
        await getCandidates({
          mealType: 'dinner',
          allergensToAvoid: [],
          excludedIngredientIds: [],
          recentMealIds: [],
          dietaryType: 'vegetarian',
          householdId: alder,
        })
      ).map((m) => m.id)
    expect(await vegetarian()).toContain(meal.id)

    await updateHouseholdIngredient(alder, 'en', row.id, {
      ...lovage,
      name: 'Kassler',
      category: 'protein',
      proteinType: 'pork',
      protein: 20,
    })

    const saved = await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } })
    expect(saved.primaryProteinType).toBe('pork')
    expect(await vegetarian()).not.toContain(meal.id)
  })

  // HON-1386: 75 g mince (26 g protein / 100 g) and 400 g beans (8.7 g) over 3
  // servings derive Legumes; the household chose Beef.
  async function beefAndBeans() {
    const { alder } = await world()
    const mince = {
      ...lovage,
      name: 'Mince',
      category: 'protein',
      proteinType: 'beef',
      protein: 26,
    } as const
    const minceRow = await createHouseholdIngredient(alder, 'en', mince)
    const beans = await createHouseholdIngredient(alder, 'en', {
      ...lovage,
      name: 'Kidney beans',
      category: 'legume',
      proteinType: 'legume',
      protein: 8.7,
    })
    const meal = await createHouseholdMeal(alder, {
      name: 'Mince and beans',
      kidFriendly: true,
      suitableFor: ['dinner'],
      servings: 3,
      components: [
        { ingredientId: minceRow.id, totalQuantity: 75 },
        { ingredientId: beans.id, totalQuantity: 400 },
      ],
      proteinTypeOverride: 'beef',
    })
    return { alder, mince, minceRow, meal }
  }

  it("clears the chosen main protein when the ingredient's protein type moves away from it", async () => {
    const { alder, mince, minceRow, meal } = await beefAndBeans()

    await updateHouseholdIngredient(alder, 'en', minceRow.id, { ...mince, proteinType: 'pork' })

    const saved = await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } })
    expect(saved.proteinTypeOverride).toBeNull()
    expect(saved.primaryProteinType).toBe('legume')
  })

  it('keeps the chosen main protein when only the protein grams change', async () => {
    const { alder, mince, minceRow, meal } = await beefAndBeans()

    await updateHouseholdIngredient(alder, 'en', minceRow.id, { ...mince, protein: 20 })

    const saved = await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } })
    expect(saved.proteinTypeOverride).toBe('beef')
    expect(saved.primaryProteinType).toBe('beef')
  })
})

describe('deleteHouseholdIngredient', () => {
  it('deletes a row nothing uses', async () => {
    const { alder } = await world()
    const row = await createHouseholdIngredient(alder, 'en', lovage)

    expect(await deleteHouseholdIngredient(alder, row.id)).toEqual({ status: 'deleted' })
    expect(await prisma.ingredient.findUnique({ where: { id: row.id } })).toBeNull()
  })

  it('refuses a row a meal and the pantry use, with the counts, and keeps it', async () => {
    const { alder } = await world()
    const row = await createHouseholdIngredient(alder, 'en', lovage)
    await mealWith(alder, row.id)
    await prisma.pantryItem.create({ data: { householdId: alder, ingredientId: row.id } })

    expect(await deleteHouseholdIngredient(alder, row.id)).toEqual({
      status: 'in_use',
      uses: { meals: 1, deletedMealsInPlan: 0, pantry: 1, shoppingList: 0, mealPlan: 0, extras: 0 },
    })
    expect(await prisma.ingredient.findUnique({ where: { id: row.id } })).not.toBeNull()
  })

  it('deletes a row only a deleted recipe with no plan entry uses, with its component', async () => {
    const { alder } = await world()
    const row = await createHouseholdIngredient(alder, 'en', lovage)
    const meal = await mealWith(alder, row.id)
    await deleteHouseholdMeal(alder, meal.id)

    expect(await deleteHouseholdIngredient(alder, row.id)).toEqual({ status: 'deleted' })
    expect(await prisma.ingredient.findUnique({ where: { id: row.id } })).toBeNull()
    expect(await prisma.mealComponent.count({ where: { mealId: meal.id } })).toBe(0)
  })

  it('refuses a row a deleted recipe in the meal plan uses, counted apart from recipes', async () => {
    const { alder } = await world()
    const row = await createHouseholdIngredient(alder, 'en', lovage)
    const meal = await mealWith(alder, row.id)
    await planEntryFor(alder, meal.id)
    await deleteHouseholdMeal(alder, meal.id)

    expect(await deleteHouseholdIngredient(alder, row.id)).toEqual({
      status: 'in_use',
      uses: { meals: 0, deletedMealsInPlan: 1, pantry: 0, shoppingList: 0, mealPlan: 0, extras: 0 },
    })
    expect(await prisma.ingredient.findUnique({ where: { id: row.id } })).not.toBeNull()
    expect(await prisma.mealComponent.count({ where: { mealId: meal.id } })).toBe(1)
  })

  it("refuses a row a live recipe uses, and keeps a deleted recipe's component too", async () => {
    const { alder } = await world()
    const row = await createHouseholdIngredient(alder, 'en', lovage)
    await mealWith(alder, row.id)
    const gone = await mealWith(alder, row.id, 'Lovage pie')
    await deleteHouseholdMeal(alder, gone.id)

    expect(await deleteHouseholdIngredient(alder, row.id)).toEqual({
      status: 'in_use',
      uses: { meals: 1, deletedMealsInPlan: 0, pantry: 0, shoppingList: 0, mealPlan: 0, extras: 0 },
    })
    expect(await prisma.mealComponent.count({ where: { mealId: gone.id } })).toBe(1)
  })

  it("returns not_found for another household's row and for a global row", async () => {
    const { alder, birch } = await world()
    const theirs = await createHouseholdIngredient(birch, 'en', lovage)
    const onion = await globalRow('onion')

    expect(await deleteHouseholdIngredient(alder, theirs.id)).toEqual({ status: 'not_found' })
    expect(await deleteHouseholdIngredient(alder, onion.id)).toEqual({ status: 'not_found' })
    expect(await prisma.ingredient.findUnique({ where: { id: theirs.id } })).not.toBeNull()
    expect(await prisma.ingredient.findUnique({ where: { id: onion.id } })).not.toBeNull()
  })
})
