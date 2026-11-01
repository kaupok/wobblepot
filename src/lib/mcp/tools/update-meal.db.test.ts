import { describe, expect, it, vi } from 'vitest'

// A saved recipe starts its image in `after()` (HON-1503), which throws outside
// a request. The test drops the callback, so no image is drawn even when the
// developer's `.env` has an OpenAI key; `create-meal.test.ts` and
// `update-meal.test.ts` assert the claim and the draw.
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))

import { runTool, ToolInputError, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { prisma } from '@/lib/prisma'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'

import { createMeal } from './create-meal'
import { getMeal } from './get-meal'
import { SERVINGS_REQUIRED, updateMeal } from './update-meal'

// Runs against PGlite with pg_trgm through the `unit-db` project, with no
// `src/lib` mocks: the recipe is saved with `create_meal`, changed with the
// real matcher, and read back (HON-1314).

const CALLER = { userId: 'user-1' }

/**
 * A household with its own ingredients and one saved recipe. The made-up
 * names never clash with the shared pool the migrations seed, so each match
 * is the one meant here.
 */
async function world(name = 'Alder') {
  const row = await prisma.household.create({ data: { name, locale: 'en' } })
  const ingredient = (id: string, ingredientName: string, defaultUnit: 'g' | 'piece') =>
    prisma.ingredient.create({
      data: {
        id: `${id}-${row.id}`,
        name: ingredientName,
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
  await ingredient('ing-paste', 'quorvex paste', 'g')
  const household = mcpHousehold({ id: row.id, locale: 'en' })

  const created = await createMeal.run(
    household,
    createMeal.inputSchema.parse({
      name: 'Glimmer lasagne',
      suitableFor: ['dinner'],
      servings: 4,
      kidFriendly: true,
      description: 'Rich layers of mince and bulb.',
      preparationNotes: 'Layer and bake.',
      timeMinutes: 60,
      ingredients: [
        { name: 'glimmer mince', quantity: 500, unit: 'g' },
        { name: 'glimmer bulb', quantity: 1, unit: 'piece' },
        { name: 'glimmer salt', quantity: null, unit: 'to taste' },
      ],
    }),
    CALLER,
  )
  return { household, mealId: created.meal!.id }
}

type Household = Awaited<ReturnType<typeof world>>['household']

function call(household: Household, input: Record<string, unknown>) {
  return updateMeal.run(household, updateMeal.inputSchema.parse(input), CALLER)
}

/** The stored recipe and its components, as `[ingredient name, per serving, vague]`. */
async function stored(mealId: string) {
  const meal = await prisma.meal.findUniqueOrThrow({
    where: { id: mealId },
    include: { components: { include: { ingredient: true } } },
  })
  return {
    ...meal,
    rows: meal.components
      .map((c) => [c.ingredient.name, c.quantityPerServing, c.isVague] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
  }
}

const ORIGINAL_ROWS = [
  ['glimmer bulb', 0.25, false],
  ['glimmer mince', 125, false],
  ['glimmer salt', 0, true],
]

describe('update_meal', () => {
  it('changes only servings, and keeps the ingredients and the other fields', async () => {
    const { household, mealId } = await world()

    const result = await call(household, { mealId, servings: 2 })

    expect(result.outcome).toBe('updated')
    expect(result.meal).toEqual({ id: mealId, name: 'Glimmer lasagne' })
    expect(result.servings).toBe(2)
    // The recipe's totals stay: 500 g of mince now makes 2 servings.
    expect(result.ingredients).toEqual([
      { name: 'glimmer mince', quantity: 500, unit: 'g', note: null },
      { name: 'glimmer bulb', quantity: 1, unit: 'piece', note: null },
      { name: 'glimmer salt', quantity: null, unit: 'g', note: 'to taste' },
    ])
    expect(updateMeal.outputSchema.safeParse(result).success).toBe(true)

    const meal = await stored(mealId)
    expect(meal).toMatchObject({
      name: 'Glimmer lasagne',
      servings: 2,
      kidFriendly: true,
      description: 'Rich layers of mince and bulb.',
      preparationNotes: 'Layer and bake.',
      timeMinutes: 60,
      suitableFor: ['dinner'],
    })
    expect(meal.rows).toEqual([
      ['glimmer bulb', 0.5, false],
      ['glimmer mince', 250, false],
      ['glimmer salt', 0, true],
    ])
  })

  it('replaces the ingredient list, and clears a field sent as null', async () => {
    const { household, mealId } = await world()

    const result = await call(household, {
      mealId,
      timeMinutes: null,
      servings: 4,
      ingredients: [
        { name: 'glimmer mince', quantity: 400, unit: 'g' },
        { name: 'quorvex paste', quantity: 40, unit: 'g' },
      ],
    })

    expect(result.outcome).toBe('updated')
    expect(result.ingredients).toEqual([
      { name: 'glimmer mince', quantity: 400, unit: 'g', note: null },
      { name: 'quorvex paste', quantity: 40, unit: 'g', note: null },
    ])

    const meal = await stored(mealId)
    expect(meal).toMatchObject({ servings: 4, timeMinutes: null, kidFriendly: true })
    expect(meal.rows).toEqual([
      ['glimmer mince', 100, false],
      ['quorvex paste', 10, false],
    ])
  })

  it('sets the description, and clears it when sent as null (HON-1502)', async () => {
    const { household, mealId } = await world()
    const read = () => getMeal.run(household, { mealId }, CALLER)

    expect((await call(household, { mealId, description: 'Sweet with banana.' })).outcome).toBe(
      'updated',
    )
    expect((await read()).meal.description).toBe('Sweet with banana.')

    expect((await call(household, { mealId, description: null })).outcome).toBe('updated')
    expect((await read()).meal.description).toBeNull()
  })

  it('stores the amounts for the servings sent, as get_meal shows them (HON-1472)', async () => {
    const { household } = await world()
    await prisma.ingredient.create({
      data: {
        id: `ing-beans-${household.id}`,
        name: 'quorvex beans',
        householdId: household.id,
        category: 'vegetable',
        defaultUnit: 'g',
        calories: 50,
        protein: 1,
        carbs: 10,
        fat: 0,
      },
    })
    const created = await createMeal.run(
      household,
      createMeal.inputSchema.parse({
        name: 'Glimmer stew',
        suitableFor: ['dinner'],
        servings: 4,
        ingredients: [
          { name: 'glimmer mince', quantity: 300, unit: 'g' },
          { name: 'quorvex beans', quantity: 400, unit: 'g' },
        ],
      }),
      CALLER,
    )
    const mealId = created.meal!.id

    // get_meal at 3 servings showed beans 300 g; the user raised the mince to 300 g.
    const result = await call(household, {
      mealId,
      servings: 3,
      ingredients: [
        { name: 'glimmer mince', quantity: 300, unit: 'g' },
        { name: 'quorvex beans', quantity: 300, unit: 'g' },
      ],
    })

    expect(result.outcome).toBe('updated')
    expect(result.servings).toBe(3)
    expect(result.ingredients).toEqual([
      { name: 'glimmer mince', quantity: 300, unit: 'g', note: null },
      { name: 'quorvex beans', quantity: 300, unit: 'g', note: null },
    ])
    expect(updateMeal.outputSchema.safeParse(result).success).toBe(true)

    const read = await getMeal.run(
      household,
      getMeal.inputSchema.parse({ mealId, servings: 3 }),
      CALLER,
    )
    expect(read.meal.servings).toBe(3)
    expect(read.meal.recipeServings).toBe(3)
    expect(read.meal.ingredients).toEqual([
      { name: 'glimmer mince', quantity: 300, unit: 'g', note: null },
      { name: 'quorvex beans', quantity: 300, unit: 'g', note: null },
    ])
  })

  it('refuses ingredients sent without servings, and changes nothing', async () => {
    const { household, mealId } = await world()

    const attempt = call(household, {
      mealId,
      ingredients: [{ name: 'glimmer mince', quantity: 300, unit: 'g' }],
    })

    await expect(attempt).rejects.toThrow(ToolInputError)
    await expect(attempt).rejects.toThrow(SERVINGS_REQUIRED)
    const meal = await stored(mealId)
    expect(meal.servings).toBe(4)
    expect(meal.rows).toEqual(ORIGINAL_ROWS)
  })

  it('changes nothing when one name has no match, and returns it with the closest ingredients', async () => {
    const { household, mealId } = await world()

    const result = await call(household, {
      mealId,
      name: 'Glimmer bake',
      servings: 4,
      ingredients: [
        { name: 'glimmer mince', quantity: 500, unit: 'g' },
        { name: 'quorvax pasta', quantity: 50, unit: 'g' },
      ],
    })

    expect(result).toEqual({
      outcome: 'unmatched',
      meal: null,
      servings: null,
      ingredients: [],
      mainProtein: null,
      unmatched: [
        { name: 'quorvax pasta', original: '50 g quorvax pasta', alternatives: ['quorvex paste'] },
      ],
      check: [],
      proteinTypes: [],
    })
    const meal = await stored(mealId)
    expect(meal.name).toBe('Glimmer lasagne')
    expect(meal.rows).toEqual(ORIGINAL_ROWS)
  })

  // HON-1546: a qualified name that finds only its bare last word is unsure, so
  // update_meal refuses it and offers the row, and does not save it as that row.
  it('changes nothing when a qualified name finds only its bare last word', async () => {
    const { household, mealId } = await world()
    await prisma.ingredient.create({
      data: {
        name: 'zibblecrust',
        householdId: household.id,
        category: 'dairy',
        defaultUnit: 'g',
        calories: 700,
        protein: 1,
        carbs: 0,
        fat: 80,
      },
    })

    const result = await call(household, {
      mealId,
      servings: 4,
      ingredients: [{ name: 'flarnwood zibblecrust', quantity: 50, unit: 'g' }],
    })

    expect(result).toMatchObject({
      outcome: 'unmatched',
      unmatched: [
        {
          name: 'flarnwood zibblecrust',
          original: '50 g flarnwood zibblecrust',
          alternatives: ['zibblecrust'],
        },
      ],
    })
    const meal = await stored(mealId)
    expect(meal.rows).toEqual(ORIGINAL_ROWS)
  })

  it('changes nothing when an amount looks wrong for the new servings', async () => {
    const { household, mealId } = await world()

    // 500 bulbs of 100 g over 4 servings is 12 500 g a serving.
    const result = await call(household, {
      mealId,
      servings: 4,
      ingredients: [{ name: 'glimmer bulb', quantity: 500, unit: 'piece' }],
    })

    expect(result.outcome).toBe('check_quantity')
    expect(result.check).toEqual([
      {
        name: 'glimmer bulb',
        quantity: 125,
        unit: 'piece',
        warning: 'Unusually high: 12500g per serving. Please verify this amount.',
      },
    ])
    expect((await stored(mealId)).rows).toEqual(ORIGINAL_ROWS)
  })

  it('answers notFound for another household’s recipe, and changes nothing', async () => {
    const alder = await world('Alder')
    const birch = await world('Birch')

    const result = await call(alder.household, { mealId: birch.mealId, servings: 2 })

    expect(result).toEqual({
      outcome: 'notFound',
      meal: null,
      servings: null,
      ingredients: [],
      mainProtein: null,
      unmatched: [],
      check: [],
      proteinTypes: [],
    })
    expect((await stored(birch.mealId)).servings).toBe(4)
  })

  it('answers notFound for a shared catalogue recipe and a deleted one', async () => {
    const { household } = await world()
    const shared = await prisma.meal.create({
      data: { name: 'Shared lasagne', suitableFor: ['dinner'], servings: 4 },
    })
    const deleted = await prisma.meal.create({
      data: {
        name: 'Old lasagne',
        suitableFor: ['dinner'],
        servings: 4,
        householdId: household.id,
        deletedAt: new Date('2026-10-01T12:00:00Z'),
      },
    })

    for (const mealId of [shared.id, deleted.id]) {
      const result = await call(household, { mealId, servings: 2 })
      expect(result.outcome).toBe('notFound')
      expect((await stored(mealId)).servings).toBe(4)
    }
  })

  it('answers a read-only token with the reconnect message, and the recipe stays', async () => {
    const { household, mealId } = await world()

    const result = await runTool(
      updateMeal,
      { userId: 'user-1', household, scopes: READ_SCOPES },
      updateMeal.inputSchema.parse({ mealId, servings: 2 }),
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
    })
    expect((await stored(mealId)).servings).toBe(4)
  })
})

// The household's chosen main protein (HON-1387). Per serving, 25 g of mince
// at 20 g protein per 100 g gives 5 g; 133 g of beans at 8.7 gives 11.6 g, so
// the beans win the automatic choice.
describe('update_meal mainProtein', () => {
  const MINCE = { name: 'glimmer beef mince', quantity: 25, unit: 'g' }
  const BEANS = { name: 'quorvex kidney beans', quantity: 133, unit: 'g' }
  const PASTE = { name: 'quorvex paste', quantity: 10, unit: 'g' }

  /** A one-serving chilli of mince and beans, saved with `mainProtein` when given. */
  async function chilli(mainProtein?: 'beef') {
    const { household } = await world()
    const ingredient = (
      id: string,
      name: string,
      proteinType: 'beef' | 'legume',
      protein: number,
    ) =>
      prisma.ingredient.create({
        data: {
          id: `${id}-${household.id}`,
          name,
          householdId: household.id,
          category: 'protein',
          defaultUnit: 'g',
          proteinType,
          calories: 150,
          protein,
          carbs: 0,
          fat: 5,
        },
      })
    await ingredient('ing-beef', 'glimmer beef mince', 'beef', 20)
    await ingredient('ing-beans', 'quorvex kidney beans', 'legume', 8.7)
    const created = await createMeal.run(
      household,
      createMeal.inputSchema.parse({
        name: 'Glimmer chilli',
        suitableFor: ['dinner'],
        servings: 1,
        ingredients: [MINCE, BEANS],
        mainProtein,
      }),
      CALLER,
    )
    return { household, mealId: created.meal!.id }
  }

  it('tells the assistant when to send mainProtein, as create_meal does', () => {
    expect(updateMeal.inputSchema.shape.mainProtein.description).toMatch(
      /^The protein the household/,
    )
    expect(updateMeal.inputSchema.shape.mainProtein.description).toBe(
      createMeal.inputSchema.shape.mainProtein.description,
    )
  })

  it('keeps the stored choice when mainProtein is left out', async () => {
    const { household, mealId } = await chilli('beef')

    const result = await call(household, { mealId, timeMinutes: 30 })

    expect(result.outcome).toBe('updated')
    expect(result.mainProtein).toEqual({ type: 'beef', setBy: 'household' })
    expect(await stored(mealId)).toMatchObject({
      primaryProteinType: 'beef',
      proteinTypeOverride: 'beef',
    })
  })

  it('sets the choice when mainProtein is one of the ingredients', async () => {
    const { household, mealId } = await chilli()

    const result = await call(household, { mealId, mainProtein: 'beef' })

    expect(result.outcome).toBe('updated')
    expect(result.mainProtein).toEqual({ type: 'beef', setBy: 'household' })
    expect(await stored(mealId)).toMatchObject({
      primaryProteinType: 'beef',
      proteinTypeOverride: 'beef',
    })
  })

  it('goes back to automatic when mainProtein is null', async () => {
    const { household, mealId } = await chilli('beef')

    const result = await call(household, { mealId, mainProtein: null })

    expect(result.outcome).toBe('updated')
    expect(result.mainProtein).toEqual({ type: 'legume', setBy: 'automatic' })
    expect(await stored(mealId)).toMatchObject({
      primaryProteinType: 'legume',
      proteinTypeOverride: null,
    })
  })

  it('changes nothing when no stored ingredient has mainProtein', async () => {
    const { household, mealId } = await chilli()

    const result = await call(household, { mealId, mainProtein: 'fish', timeMinutes: 30 })

    expect(result.outcome).toBe('check_protein')
    expect(result.mainProtein).toBeNull()
    expect([...result.proteinTypes].sort()).toEqual(['beef', 'legume'])
    expect(await stored(mealId)).toMatchObject({
      timeMinutes: null,
      primaryProteinType: 'legume',
      proteinTypeOverride: null,
    })
  })

  it('checks mainProtein against the new ingredients, and changes nothing when they drop it', async () => {
    const { household, mealId } = await chilli('beef')

    const result = await call(household, {
      mealId,
      mainProtein: 'beef',
      servings: 1,
      ingredients: [BEANS, PASTE],
    })

    expect(result.outcome).toBe('check_protein')
    expect(result.proteinTypes).toEqual(['legume'])
    const meal = await stored(mealId)
    expect(meal).toMatchObject({ primaryProteinType: 'beef', proteinTypeOverride: 'beef' })
    expect(meal.rows.map(([name]) => name)).toEqual(['glimmer beef mince', 'quorvex kidney beans'])
  })

  it('clears the stored choice when the new ingredients alone drop it', async () => {
    const { household, mealId } = await chilli('beef')

    const result = await call(household, { mealId, servings: 1, ingredients: [BEANS, PASTE] })

    expect(result.outcome).toBe('updated')
    expect(result.mainProtein).toEqual({ type: 'legume', setBy: 'automatic' })
    expect(await stored(mealId)).toMatchObject({
      primaryProteinType: 'legume',
      proteinTypeOverride: null,
    })
  })
})
