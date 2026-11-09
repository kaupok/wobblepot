import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prisma } from '@/lib/prisma'

import {
  type SeedClient,
  seedIngredients,
  seedIngredientTranslationsEt,
  seedMeals,
  seedMealTranslationsEt,
} from './seed-sync'
import type { IngredientInput } from './seed-types'

// "carrot" is a name pieceDisplayFor counts in pieces; plain grams with
// no density is measured by weight, not volume.
const carrot: IngredientInput = {
  name: 'carrot',
  category: 'vegetable',
  defaultUnit: 'g',
  allergens: [],
  calories: 41,
  protein: 0.9,
  carbs: 9.6,
  fat: 0.2,
  gramsPerPiece: 60,
}
const rice: IngredientInput = {
  name: 'rice',
  category: 'carb',
  defaultUnit: 'g',
  allergens: [],
  calories: 360,
  protein: 7,
  carbs: 80,
  fat: 0.6,
}
const INGREDIENTS = [carrot, rice]

const MEALS = [
  {
    name: 'Seedtest Carrot Rice',
    description: 'Rice with carrots.',
    timeMinutes: 25,
    kidFriendly: true,
    suitableFor: ['lunch', 'dinner'],
    primaryProteinType: 'none',
    components: [
      { ingredient: 'carrot', quantity: 80 },
      { ingredient: 'rice', quantity: 70 },
    ],
  },
]

const MEAL_ET = [
  { enName: 'Seedtest Carrot Rice', et: { name: 'Porgandiriis', description: 'Riis porgandiga.' } },
]
const INGREDIENT_ET = [
  { en: 'carrot', et: 'porgand' },
  { en: 'rice', et: 'riis' },
]

const WRITES = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
])

/** A client that records every operation it sends, so a test can count writes. */
function countingClient() {
  const operations: string[] = []
  const client = prisma.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        operations.push(`${model}.${operation}`)
        return query(args)
      },
    },
  }) as unknown as SeedClient
  const writes = () => operations.filter((op) => WRITES.has(op.split('.')[1]!))
  return { client, operations, writes }
}

async function seedAll(client: SeedClient, ingredients = INGREDIENTS, meals = MEALS) {
  await seedIngredients(client, ingredients)
  await seedMeals(client, meals)
  await seedMealTranslationsEt(client, MEAL_ET)
  await seedIngredientTranslationsEt(client, INGREDIENT_ET)
}

const globalIngredient = (name: string) =>
  prisma.ingredient.findFirstOrThrow({ where: { name, householdId: null } })
const globalMeal = (name: string) =>
  prisma.meal.findFirstOrThrow({ where: { name, householdId: null } })

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // The migrations seed global ingredients; the translation functions check
  // every global row, so each test starts from an empty global pool.
  await prisma.ingredientTranslation.deleteMany()
  await prisma.ingredient.deleteMany()
})

describe('first run on an empty pool', () => {
  it('creates the ingredients, meals with components, and translations', async () => {
    await seedAll(prisma)

    const storedCarrot = await globalIngredient('carrot')
    expect(storedCarrot.gramsPerPiece).toBe(60)
    expect(storedCarrot.calories).toBe(41)

    const meal = await prisma.meal.findFirstOrThrow({
      where: { name: 'Seedtest Carrot Rice', householdId: null },
      include: { components: { include: { ingredient: true } } },
    })
    expect(meal.timeMinutes).toBe(25)
    expect(meal.suitableFor).toEqual(['lunch', 'dinner'])
    expect(meal.components.map((c) => [c.ingredient.name, c.quantityPerServing]).sort()).toEqual([
      ['carrot', 80],
      ['rice', 70],
    ])

    const mealEt = await prisma.mealTranslation.findUniqueOrThrow({
      where: { mealId_locale: { mealId: meal.id, locale: 'et' } },
    })
    expect(mealEt).toMatchObject({
      name: 'Porgandiriis',
      description: 'Riis porgandiga.',
      preparationNotes: null,
    })
    const riceEt = await prisma.ingredientTranslation.findFirstOrThrow({
      where: { ingredient: { name: 'rice' }, locale: 'et' },
    })
    expect(riceEt.name).toBe('riis')
  })
})

describe('second run with the same data', () => {
  it('sends no write and keeps Meal.updatedAt', async () => {
    await seedAll(prisma)
    const before = await globalMeal('Seedtest Carrot Rice')

    const { client, operations, writes } = countingClient()
    await seedAll(client)

    expect(writes()).toEqual([])
    expect((await globalMeal('Seedtest Carrot Rice')).updatedAt).toEqual(before.updatedAt)
    // ingredient, ingredient + meal, meal + translation, ingredient + translation
    expect(operations).toHaveLength(7)
  })

  it('sends the same number of reads for a larger pool', async () => {
    const more: IngredientInput[] = Array.from({ length: 12 }, (_, i) => ({
      ...rice,
      name: `extra ${i}`,
    }))
    await seedIngredients(prisma, [...INGREDIENTS, ...more])

    const { client, operations, writes } = countingClient()
    await seedIngredients(client, [...INGREDIENTS, ...more])

    expect(writes()).toEqual([])
    expect(operations).toEqual(['Ingredient.findMany'])
  })
})

describe('drift', () => {
  it.each([
    ['measuredByVolume', { measuredByVolume: true }, { measuredByVolume: false }],
    ['pieceDisplay', { pieceDisplay: 'none' as const }, { pieceDisplay: 'recipe_and_shopping' }],
  ])('rewrites a drifted %s and leaves a matching row unwritten', async (_, drift, seeded) => {
    await seedAll(prisma)
    const storedCarrot = await globalIngredient('carrot')
    await prisma.ingredient.update({ where: { id: storedCarrot.id }, data: drift })

    const { client, writes } = countingClient()
    await seedIngredients(client, INGREDIENTS)

    expect(writes()).toEqual(['Ingredient.update'])
    expect(await globalIngredient('carrot')).toMatchObject(seeded)
  })

  it('rewrites a drifted ingredient translation name', async () => {
    await seedAll(prisma)
    await prisma.ingredientTranslation.updateMany({
      where: { name: 'riis' },
      data: { name: 'hand edit' },
    })

    const { client, writes } = countingClient()
    await seedIngredientTranslationsEt(client, INGREDIENT_ET)

    expect(writes()).toEqual(['IngredientTranslation.update'])
    const riceEt = await prisma.ingredientTranslation.findFirstOrThrow({
      where: { ingredient: { name: 'rice' }, locale: 'et' },
    })
    expect(riceEt.name).toBe('riis')
  })

  it.each([
    ['name', { name: 'hand edit' }],
    ['description', { description: 'hand edit' }],
    ['preparationNotes', { preparationNotes: 'hand edit' }],
  ])('rewrites a drifted meal translation %s', async (_, drift) => {
    await seedAll(prisma)
    await prisma.mealTranslation.updateMany({ data: drift })

    const { client, writes } = countingClient()
    await seedMealTranslationsEt(client, MEAL_ET)

    expect(writes()).toEqual(['MealTranslation.update'])
    const mealEt = await prisma.mealTranslation.findFirstOrThrow({ where: { locale: 'et' } })
    expect(mealEt).toMatchObject({
      name: 'Porgandiriis',
      description: 'Riis porgandiga.',
      preparationNotes: null,
    })
  })

  it('rewrites a drifted timeMinutes and keeps the image fields', async () => {
    await seedAll(prisma)
    const meal = await globalMeal('Seedtest Carrot Rice')
    await prisma.meal.update({
      where: { id: meal.id },
      data: { timeMinutes: 90, imageUrl: 'https://blob.example/carrot.png', imageStatus: 'ready' },
    })

    const { client, writes } = countingClient()
    await seedMeals(client, MEALS)

    expect(writes()).toEqual(['Meal.update'])
    const fixed = await globalMeal('Seedtest Carrot Rice')
    expect(fixed.timeMinutes).toBe(25)
    expect(fixed.imageUrl).toBe('https://blob.example/carrot.png')
    expect(fixed.imageStatus).toBe('ready')
  })

  it('clears the image fields when the description changes', async () => {
    await seedAll(prisma)
    const meal = await globalMeal('Seedtest Carrot Rice')
    await prisma.meal.update({
      where: { id: meal.id },
      data: { imageUrl: 'https://blob.example/carrot.png', imageStatus: 'ready', imageHue: 30 },
    })

    await seedMeals(prisma, [{ ...MEALS[0]!, description: 'Rice with roasted carrots.' }])

    const fixed = await globalMeal('Seedtest Carrot Rice')
    expect(fixed.description).toBe('Rice with roasted carrots.')
    expect(fixed.imageUrl).toBeNull()
    expect(fixed.imageStatus).toBe('none')
    expect(fixed.imageHue).toBeNull()
  })
})

describe('what the seed leaves alone', () => {
  it("keeps an existing ingredient's nutrition and a meal's components", async () => {
    await seedAll(prisma)
    const storedCarrot = await globalIngredient('carrot')
    await prisma.ingredient.update({ where: { id: storedCarrot.id }, data: { calories: 99 } })
    const meal = await globalMeal('Seedtest Carrot Rice')
    await prisma.mealComponent.updateMany({
      where: { mealId: meal.id, ingredientId: storedCarrot.id },
      data: { quantityPerServing: 200 },
    })

    const { client, writes } = countingClient()
    await seedAll(client)

    expect(writes()).toEqual([])
    expect((await globalIngredient('carrot')).calories).toBe(99)
    const component = await prisma.mealComponent.findFirstOrThrow({
      where: { mealId: meal.id, ingredientId: storedCarrot.id },
    })
    expect(component.quantityPerServing).toBe(200)
  })

  it('never writes a household meal with a global name', async () => {
    await seedIngredients(prisma, INGREDIENTS)
    const alder = await prisma.household.create({ data: { id: 'alder', name: 'Alder' } })
    const own = await prisma.meal.create({
      data: { name: 'Seedtest Carrot Rice', householdId: alder.id, timeMinutes: 90 },
    })

    await seedMeals(prisma, MEALS)

    const after = await prisma.meal.findUniqueOrThrow({ where: { id: own.id } })
    expect(after.timeMinutes).toBe(90)
    expect(after.updatedAt).toEqual(own.updatedAt)
    expect((await globalMeal('Seedtest Carrot Rice')).timeMinutes).toBe(25)
  })

  it('keeps a stored gramsPerPiece when the seed entry has no gramsPerPiece key', async () => {
    await seedIngredients(prisma, INGREDIENTS)
    const storedRice = await globalIngredient('rice')
    await prisma.ingredient.update({ where: { id: storedRice.id }, data: { gramsPerPiece: 5 } })

    const { client, writes } = countingClient()
    await seedIngredients(client, INGREDIENTS)

    expect(writes()).toEqual([])
    expect((await globalIngredient('rice')).gramsPerPiece).toBe(5)
  })

  it('never reads or writes a household row with a global name', async () => {
    const alder = await prisma.household.create({ data: { id: 'alder', name: 'Alder' } })
    const own = await prisma.ingredient.create({
      data: {
        ...rice,
        name: 'carrot',
        householdId: alder.id,
        measuredByVolume: true,
        gramsPerPiece: 999,
      },
    })

    await seedIngredients(prisma, INGREDIENTS)

    const after = await prisma.ingredient.findUniqueOrThrow({ where: { id: own.id } })
    expect(after.measuredByVolume).toBe(true)
    expect(after.gramsPerPiece).toBe(999)
    expect((await globalIngredient('carrot')).gramsPerPiece).toBe(60)
  })

  it('skips a meal with a missing ingredient and warns', async () => {
    await seedIngredients(prisma, [rice])

    await seedMeals(prisma, MEALS)

    expect(await prisma.meal.count({ where: { householdId: null } })).toBe(0)
    expect(console.warn).toHaveBeenCalledWith(
      'Skipping "Seedtest Carrot Rice" - missing ingredients: carrot',
    )
  })
})

describe('translation guards', () => {
  it('throws when a global ingredient has no et entry', async () => {
    await seedIngredients(prisma, INGREDIENTS)

    await expect(
      seedIngredientTranslationsEt(prisma, [{ en: 'rice', et: 'riis' }]),
    ).rejects.toThrow('Missing et translation for 1 global ingredient(s): carrot')
  })

  it('throws when a global meal has no et entry', async () => {
    await seedIngredients(prisma, INGREDIENTS)
    await seedMeals(prisma, MEALS)

    await expect(seedMealTranslationsEt(prisma, [])).rejects.toThrow(
      'Missing et translation for 1 seeded meal(s): Seedtest Carrot Rice',
    )
  })

  it('throws on a duplicate translation entry', async () => {
    await expect(
      seedIngredientTranslationsEt(prisma, [...INGREDIENT_ET, { en: 'rice', et: 'x' }]),
    ).rejects.toThrow('Duplicate et ingredient translation entry for "rice"')
    await expect(seedMealTranslationsEt(prisma, [...MEAL_ET, ...MEAL_ET])).rejects.toThrow(
      'Duplicate et meal translation entry for "Seedtest Carrot Rice"',
    )
  })
})
