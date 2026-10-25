import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { listHouseholdMeals } from '@/lib/household-meals'
import { mcpHousehold } from '@/test/mcp'
import { createMeal } from './create-meal'
import { getMeal } from './get-meal'

// Runs against PGlite with pg_trgm through the `unit-db` project, with no
// mocks: the household's ingredients are written with Prisma, found by the
// real matcher, and the recipe is read back (HON-1305).

const CALLER = { userId: 'user-1' }

/**
 * A household with its own ingredients. Their made-up names never clash with
 * the shared pool the migrations seed, so each match is the one meant here.
 */
async function world() {
  const row = await prisma.household.create({ data: { name: 'Alder', locale: 'en' } })
  const ingredient = (id: string, name: string, defaultUnit: 'g' | 'piece') =>
    prisma.ingredient.create({
      data: {
        id,
        name,
        householdId: row.id,
        category: 'vegetable',
        defaultUnit,
        gramsPerPiece: defaultUnit === 'piece' ? 100 : null,
        calories: 50,
        protein: 1,
        carbs: 10,
        fat: 0,
      },
    })
  await ingredient('ing-mince', 'glimmer mince', 'g')
  await ingredient('ing-bulb', 'glimmer bulb', 'piece')
  await ingredient('ing-salt', 'glimmer salt', 'g')
  await ingredient('ing-jam', 'brindleberry jam', 'g')
  await ingredient('ing-paste', 'quorvex paste', 'g')
  return mcpHousehold({ id: row.id, locale: 'en' })
}

const LASAGNE = {
  name: 'Glimmer lasagne',
  suitableFor: ['dinner'],
  servings: 4,
  kidFriendly: true,
  preparationNotes: 'Layer and bake.',
  timeMinutes: 60,
  ingredients: [
    { name: 'glimmer mince', quantity: 500, unit: 'g' },
    { name: 'glimmer bulb', quantity: 1, unit: 'piece' },
    { name: 'glimmer salt', quantity: null, unit: 'to taste' },
  ],
}

type Household = Awaited<ReturnType<typeof world>>

function call(household: Household, input: Record<string, unknown>) {
  return createMeal.run(household, createMeal.inputSchema.parse(input), CALLER)
}

function mealCount(householdId: string) {
  return prisma.meal.count({ where: { householdId } })
}

describe('create_meal', () => {
  it('saves the recipe when every ingredient matches, and get_meal returns it', async () => {
    const household = await world()

    const result = await call(household, LASAGNE)

    expect(result.outcome).toBe('created')
    expect(result.unmatched).toEqual([])
    expect(result.check).toEqual([])
    expect(result.ingredients).toEqual([
      { name: 'glimmer mince', quantity: 500, unit: 'g', note: null },
      { name: 'glimmer bulb', quantity: 1, unit: 'piece', note: null },
      { name: 'glimmer salt', quantity: null, unit: 'g', note: 'to taste' },
    ])

    const stored = await prisma.meal.findUniqueOrThrow({
      where: { id: result.meal!.id },
      include: { components: { orderBy: { ingredientId: 'asc' } } },
    })
    expect(stored).toMatchObject({
      name: 'Glimmer lasagne',
      householdId: household.id,
      suitableFor: ['dinner'],
      servings: 4,
      kidFriendly: true,
      preparationNotes: 'Layer and bake.',
      timeMinutes: 60,
      deletedAt: null,
    })
    expect(stored.components.map((c) => [c.ingredientId, c.quantityPerServing, c.isVague])).toEqual(
      [
        ['ing-bulb', 0.25, false],
        ['ing-mince', 125, false],
        ['ing-salt', 0, true],
      ],
    )

    const read = await getMeal.run(household, { mealId: result.meal!.id, servings: 4 }, CALLER)
    expect(read.meal).toMatchObject({
      name: 'Glimmer lasagne',
      mealTypes: ['dinner'],
      timeMinutes: 60,
      preparationNotes: 'Layer and bake.',
      isOwnRecipe: true,
    })
    expect(read.meal.ingredients.map((i) => i.name).sort()).toEqual([
      'glimmer bulb',
      'glimmer mince',
      'glimmer salt',
    ])

    // The Recipes page lists the household's recipes through this read
    // (`GET /api/households/me/meals`).
    const page = await listHouseholdMeals({ householdId: household.id, locale: 'en' })
    expect(page.meals.map((m) => [m.id, m.name, m.servings, m.timeMinutes])).toEqual([
      [result.meal!.id, 'Glimmer lasagne', 4, 60],
    ])
  })

  it('saves nothing when one name has no match, and returns it with the closest ingredients', async () => {
    const household = await world()

    const result = await call(household, {
      ...LASAGNE,
      ingredients: [...LASAGNE.ingredients, { name: 'quorvax pasta', quantity: 50, unit: 'g' }],
    })

    expect(result).toEqual({
      outcome: 'unmatched',
      meal: null,
      ingredients: [],
      unmatched: [
        { name: 'quorvax pasta', original: '50 g quorvax pasta', alternatives: ['quorvex paste'] },
      ],
      check: [],
    })
    expect(await mealCount(household.id)).toBe(0)
  })

  it('saves nothing when one match is unsure, and returns it with the alternatives', async () => {
    const household = await world()

    const result = await call(household, {
      ...LASAGNE,
      ingredients: [...LASAGNE.ingredients, { name: 'brindleberry jelly', quantity: 2, unit: 'g' }],
    })

    expect(result.outcome).toBe('unmatched')
    expect(result.unmatched).toEqual([
      {
        name: 'brindleberry jelly',
        original: '2 g brindleberry jelly',
        alternatives: ['brindleberry jam'],
      },
    ])
    expect(await mealCount(household.id)).toBe(0)
  })

  it('saves nothing when an unsure match lands on the same ingredient as a sure one', async () => {
    const household = await world()

    const result = await call(household, {
      ...LASAGNE,
      ingredients: [
        ...LASAGNE.ingredients,
        { name: 'brindleberry jam', quantity: 2, unit: 'g' },
        { name: 'brindleberry jelly', quantity: 3, unit: 'g' },
      ],
    })

    expect(result.outcome).toBe('unmatched')
    expect(result.unmatched).toEqual([
      {
        name: 'brindleberry jelly',
        original: '2 g brindleberry jam + 3 g brindleberry jelly',
        alternatives: ['brindleberry jam'],
      },
    ])
    expect(await mealCount(household.id)).toBe(0)
  })

  it('saves nothing when an amount looks wrong, and returns it per serving with the warning', async () => {
    const household = await world()

    // The assistant meant 500 g and sent piece: 125 bulbs of 100 g per serving.
    const result = await call(household, {
      ...LASAGNE,
      ingredients: [
        { name: 'glimmer mince', quantity: 500, unit: 'g' },
        { name: 'glimmer bulb', quantity: 500, unit: 'piece' },
      ],
    })

    expect(result).toEqual({
      outcome: 'check_quantity',
      meal: null,
      ingredients: [],
      unmatched: [],
      check: [
        {
          name: 'glimmer bulb',
          quantity: 125,
          unit: 'piece',
          warning: 'Unusually high: 12500g per serving. Please verify this amount.',
        },
      ],
    })
    expect(createMeal.outputSchema.safeParse(result).success).toBe(true)
    expect(await mealCount(household.id)).toBe(0)
  })

  it('returns every flagged amount, rounded to one decimal per serving', async () => {
    const household = await world()

    const result = await call(household, {
      ...LASAGNE,
      servings: 3,
      ingredients: [
        { name: 'glimmer mince', quantity: 2000, unit: 'g' },
        { name: 'glimmer bulb', quantity: 500, unit: 'piece' },
        { name: 'glimmer salt', quantity: null, unit: 'to taste' },
      ],
    })

    expect(result.outcome).toBe('check_quantity')
    expect(result.check.map((c) => [c.name, c.quantity, c.unit])).toEqual([
      ['glimmer mince', 666.7, 'g'],
      ['glimmer bulb', 166.7, 'piece'],
    ])
    expect(await mealCount(household.id)).toBe(0)
  })

  it('returns unmatched, not check_quantity, when a call has both kinds of row', async () => {
    const household = await world()

    const result = await call(household, {
      ...LASAGNE,
      ingredients: [
        { name: 'glimmer bulb', quantity: 500, unit: 'piece' },
        { name: 'quorvax pasta', quantity: 50, unit: 'g' },
      ],
    })

    expect(result.outcome).toBe('unmatched')
    expect(result.unmatched.map((u) => u.name)).toEqual(['quorvax pasta'])
    expect(result.check).toEqual([])
    expect(await mealCount(household.id)).toBe(0)
  })

  it('saves nothing when the household has a recipe of that name in another case', async () => {
    const household = await world()
    const existing = await prisma.meal.create({
      data: { name: 'Glimmer Lasagne', suitableFor: ['dinner'], householdId: household.id },
    })

    const result = await call(household, { ...LASAGNE, name: '  glimmer LASAGNE ' })

    expect(result).toEqual({
      outcome: 'exists',
      meal: { id: existing.id, name: 'Glimmer Lasagne' },
      ingredients: [],
      unmatched: [],
      check: [],
    })
    expect(await mealCount(household.id)).toBe(1)
  })

  it('saves the recipe when only a shared or a deleted recipe has that name', async () => {
    const household = await world()
    await prisma.meal.create({ data: { name: 'Glimmer lasagne', suitableFor: ['dinner'] } })
    await prisma.meal.create({
      data: {
        name: 'Glimmer lasagne',
        suitableFor: ['dinner'],
        householdId: household.id,
        deletedAt: new Date('2026-10-01T12:00:00Z'),
      },
    })

    const result = await call(household, LASAGNE)

    expect(result.outcome).toBe('created')
    expect(await prisma.meal.count({ where: { householdId: household.id, deletedAt: null } })).toBe(
      1,
    )
  })

  it.each([
    ['more servings than the app allows', { servings: 51 }],
    ['an empty name', { name: '   ' }],
    ['no meal type', { suitableFor: [] }],
    ['a longer time than the app allows', { timeMinutes: 481 }],
    [
      'grams with no quantity',
      { ingredients: [{ name: 'glimmer mince', quantity: null, unit: 'g' }] },
    ],
    [
      'a vague amount with a quantity',
      { ingredients: [{ name: 'glimmer salt', quantity: 1, unit: 'to taste' }] },
    ],
    ['no ingredients', { ingredients: [] }],
  ])('refuses %s in validation', (_label, override) => {
    expect(createMeal.inputSchema.safeParse({ ...LASAGNE, ...override }).success).toBe(false)
  })
})
