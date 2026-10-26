import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { MEAL_IMAGE_PROMPT_VERSION } from '@/lib/meal-images/prompt'
import type { Allergen, ProteinType } from '@/generated/prisma/enums'
import {
  createHouseholdMeal,
  deleteHouseholdMeal,
  getHouseholdMeal,
  HouseholdMealError,
  listHouseholdMeals,
  updateHouseholdMeal,
  type HouseholdMealCreateInput,
  type HouseholdMealPatch,
  type HouseholdMealRefusal,
} from '@/lib/household-meals'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks:
// rows are written with Prisma, changed through the lib functions, and read
// back. The route tests cover only how the routes map these answers.

const CURRY_IMAGE = 'https://store.example/meals/meal-curry.png'
const TIPS = 'Pat the chicken dry'

/**
 * Alder owns a chicken curry (4 servings of 150 g chicken and 100 g rice, with
 * a ready image, an Estonian translation and a planned entry with cached
 * tips), an omelette of 2 eggs and 30 g cheese for 1, and a deleted soup.
 * Birch owns a pie and an ingredient of its own. The library has one meal.
 * The ingredients belong to Alder, so their names never clash with the shared
 * pool the migrations seed.
 */
async function world() {
  const alder = await prisma.household.create({
    data: { name: 'Alder', mealPlans: { create: { id: 'plan-alder' } } },
  })
  const birch = await prisma.household.create({ data: { name: 'Birch' } })

  const ingredient = (
    id: string,
    data: {
      protein: number
      proteinType?: ProteinType
      defaultUnit?: 'g' | 'piece'
      gramsPerPiece?: number
      allergens?: Allergen[]
      householdId?: string
    },
  ) =>
    prisma.ingredient.create({
      data: {
        id,
        name: id.replace('ing-', ''),
        householdId: alder.id,
        category: 'protein',
        defaultUnit: 'g',
        calories: 100,
        carbs: 10,
        fat: 5,
        ...data,
      },
    })
  await ingredient('ing-chicken', { protein: 31, proteinType: 'poultry' })
  await ingredient('ing-tofu', { protein: 8, proteinType: 'legume', allergens: ['soy'] })
  await ingredient('ing-rice', { protein: 3 })
  await ingredient('ing-egg', {
    protein: 13,
    proteinType: 'eggs',
    defaultUnit: 'piece',
    gramsPerPiece: 50,
    allergens: ['eggs'],
  })
  await ingredient('ing-cheese', { protein: 25, proteinType: 'dairy', allergens: ['dairy'] })
  await ingredient('ing-birch', { protein: 1, householdId: birch.id })
  await prisma.ingredientTranslation.create({
    data: { ingredientId: 'ing-chicken', locale: 'et', name: 'Kana' },
  })

  await prisma.meal.create({
    data: {
      id: 'meal-curry',
      name: 'Chicken curry',
      description: 'Mild and creamy',
      preparationNotes: 'Simmer slowly',
      sourceUrl: 'https://example.com/curry',
      timeMinutes: 40,
      suitableFor: ['dinner'],
      servings: 4,
      primaryProteinType: 'poultry',
      householdId: alder.id,
      imageUrl: CURRY_IMAGE,
      imageStatus: 'ready',
      imageHue: 30,
      imagePromptVersion: MEAL_IMAGE_PROMPT_VERSION,
      updatedAt: new Date('2026-10-03T12:00:00Z'),
      components: {
        create: [
          { ingredientId: 'ing-chicken', quantityPerServing: 150 },
          { ingredientId: 'ing-rice', quantityPerServing: 100 },
        ],
      },
      translations: { create: { locale: 'et', name: 'Kanakarri', description: 'Mahe' } },
    },
  })
  await prisma.meal.create({
    data: {
      id: 'meal-omelette',
      name: 'Cheese omelette',
      suitableFor: ['breakfast'],
      servings: 1,
      householdId: alder.id,
      imageUrl: 'https://store.example/meals/meal-omelette.png',
      imageStatus: 'ready',
      updatedAt: new Date('2026-10-02T12:00:00Z'),
      components: {
        create: [
          { ingredientId: 'ing-egg', quantityPerServing: 2 },
          { ingredientId: 'ing-cheese', quantityPerServing: 30 },
        ],
      },
    },
  })
  await prisma.meal.create({
    data: {
      id: 'meal-soup',
      name: 'Rice soup',
      suitableFor: ['lunch'],
      householdId: alder.id,
      deletedAt: new Date('2026-10-01T12:00:00Z'),
      updatedAt: new Date('2026-10-01T12:00:00Z'),
    },
  })
  await prisma.meal.create({
    data: { id: 'meal-birch', name: 'Birch pie', suitableFor: ['dinner'], householdId: birch.id },
  })
  await prisma.meal.create({
    data: { id: 'meal-library', name: 'Library stew', suitableFor: ['dinner'] },
  })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-curry',
      planId: 'plan-alder',
      mealId: 'meal-curry',
      date: new Date('2026-10-20T00:00:00Z'),
      mealType: 'dinner',
      preparationTips: TIPS,
    },
  })

  return { alder: alder.id, birch: birch.id }
}

async function refusalOf(promise: Promise<unknown>): Promise<HouseholdMealError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof HouseholdMealError)) throw new Error(`Expected a refusal, got ${error}`)
  return error
}

async function reasonOf(promise: Promise<unknown>): Promise<HouseholdMealRefusal> {
  return (await refusalOf(promise)).reason
}

/** The meal's component rows as `ingredientId=quantityPerServing`, by id. */
async function componentsOf(mealId: string) {
  const rows = await prisma.mealComponent.findMany({
    where: { mealId },
    orderBy: { ingredientId: 'asc' },
  })
  return rows.map((row) => `${row.ingredientId}=${row.quantityPerServing}`)
}

const tipsOf = async () =>
  (await prisma.mealPlanEntry.findUniqueOrThrow({ where: { id: 'entry-curry' } })).preparationTips

const imageOf = (id: string) =>
  prisma.meal.findUniqueOrThrow({
    where: { id },
    select: { imageUrl: true, imageStatus: true, imageHue: true },
  })

/** The curry exactly as stored, as the edit form resends it on every save. */
const CURRY_AS_STORED = {
  name: 'Chicken curry',
  description: 'Mild and creamy',
  preparationNotes: 'Simmer slowly',
  sourceUrl: 'https://example.com/curry',
  timeMinutes: 40,
  kidFriendly: false,
  suitableFor: ['dinner' as const],
  servings: 4,
  components: [
    { ingredientId: 'ing-chicken', totalQuantity: 600 },
    { ingredientId: 'ing-rice', totalQuantity: 400 },
  ],
}

describe('listHouseholdMeals', () => {
  it("lists the household's live meals, newest first, with nutrition and allergens", async () => {
    const { alder } = await world()

    const { meals, nextCursor } = await listHouseholdMeals({ householdId: alder, locale: 'en' })

    expect(meals.map((meal) => meal.id)).toEqual(['meal-curry', 'meal-omelette'])
    expect(nextCursor).toBeNull()
    // 150 g chicken and 100 g rice at 100 kcal, 31 g and 3 g protein per 100 g.
    expect(meals[0]!.nutrition).toEqual({ calories: 250, protein: 50, carbs: 25, fat: 13 })
    // 2 eggs at 50 g each and 30 g cheese.
    expect(meals[1]!.allergens.sort()).toEqual(['dairy', 'eggs'])
    expect(meals[0]).toMatchObject({ imageUrl: CURRY_IMAGE, imageHue: 30, isFavorite: false })
  })

  it('includes the deleted meal only when asked, and filters by a case-insensitive search', async () => {
    const { alder } = await world()

    const withDeleted = await listHouseholdMeals({
      householdId: alder,
      locale: 'en',
      includeDeleted: true,
    })
    const searched = await listHouseholdMeals({ householdId: alder, locale: 'en', search: 'CURRY' })

    expect(withDeleted.meals.map((meal) => meal.id)).toEqual([
      'meal-curry',
      'meal-omelette',
      'meal-soup',
    ])
    expect(searched.meals.map((meal) => meal.id)).toEqual(['meal-curry'])
  })

  it('pages by cursor', async () => {
    const { alder } = await world()

    const first = await listHouseholdMeals({ householdId: alder, locale: 'en', limit: 1 })
    const second = await listHouseholdMeals({
      householdId: alder,
      locale: 'en',
      limit: 1,
      cursor: first.nextCursor,
    })

    expect(first).toMatchObject({ nextCursor: 'meal-curry' })
    expect(first.meals.map((meal) => meal.id)).toEqual(['meal-curry'])
    expect(second.meals.map((meal) => meal.id)).toEqual(['meal-omelette'])
    expect(second.nextCursor).toBeNull()
  })

  // Specification (HON-1232): an unknown cursor ends the list. An id with no
  // row gives an empty page and no `nextCursor`, not a repeat of page one
  // under the pages already shown. Remove only sets `deletedAt`, so a removed
  // meal's id is still a valid cursor.
  it('answers an unknown cursor with an empty page', async () => {
    const { alder } = await world()

    const stale = await listHouseholdMeals({
      householdId: alder,
      locale: 'en',
      limit: 1,
      cursor: 'meal-gone',
    })

    expect(stale).toEqual({ meals: [], nextCursor: null })
  })

  it('translates the meal and its ingredients into the household locale', async () => {
    const { alder } = await world()

    const { meals } = await listHouseholdMeals({ householdId: alder, locale: 'et' })

    expect(meals[0]).toMatchObject({ name: 'Kanakarri', description: 'Mahe' })
    expect(meals[0]!.components.map((c) => c.ingredient.name)).toEqual(['Kana', 'rice'])
  })
})

describe('createHouseholdMeal', () => {
  const input: HouseholdMealCreateInput = {
    name: 'Tofu bowl',
    description: 'Quick',
    preparationNotes: null,
    sourceUrl: 'https://example.com/bowl',
    timeMinutes: 15,
    kidFriendly: true,
    suitableFor: ['lunch', 'dinner'],
    servings: 2,
    components: [
      { ingredientId: 'ing-tofu', totalQuantity: 400 },
      { ingredientId: 'ing-chicken', totalQuantity: 100 },
      { ingredientId: 'ing-rice', totalQuantity: 0, isVague: true, originalPhrase: 'some rice' },
    ],
  }

  it('stores the meal with each component per serving and the derived protein', async () => {
    const { alder } = await world()

    const meal = await createHouseholdMeal(alder, input)

    const row = await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } })
    expect(row).toMatchObject({
      name: 'Tofu bowl',
      householdId: alder,
      servings: 2,
      kidFriendly: true,
      suitableFor: ['lunch', 'dinner'],
      sourceUrl: 'https://example.com/bowl',
      // Tofu gives 200 g × 8% = 16 g protein a serving, chicken 50 g × 31% = 15.5 g.
      primaryProteinType: 'legume',
      deletedAt: null,
    })
    expect(await componentsOf(meal.id)).toEqual(['ing-chicken=50', 'ing-rice=0', 'ing-tofu=200'])
    const vague = await prisma.mealComponent.findFirstOrThrow({
      where: { mealId: meal.id, ingredientId: 'ing-rice' },
    })
    expect(vague).toMatchObject({ isVague: true, originalPhrase: 'some rice' })
  })

  it('writes no translation rows, and answers with nutrition and allergens', async () => {
    const { alder } = await world()

    const meal = await createHouseholdMeal(alder, input)

    expect(await prisma.mealTranslation.count({ where: { mealId: meal.id } })).toBe(0)
    expect(meal).toMatchObject({
      name: 'Tofu bowl',
      isCustom: true,
      isFavorite: false,
      allergens: ['soy'],
      // 250 g of 100 kcal ingredients; the vague rice counts for nothing.
      nutrition: { calories: 250, protein: 32, carbs: 25, fat: 13 },
    })
  })

  it('accepts a global ingredient from the shared pool', async () => {
    const { alder } = await world()
    const global = await prisma.ingredient.findFirstOrThrow({ where: { householdId: null } })

    const meal = await createHouseholdMeal(alder, {
      ...input,
      components: [{ ingredientId: global.id, totalQuantity: 100 }],
    })

    expect(await componentsOf(meal.id)).toEqual([`${global.id}=50`])
  })

  it("refuses an unknown or another household's ingredient, names both, and writes nothing", async () => {
    const { alder } = await world()
    const before = await prisma.meal.count()

    const error = await refusalOf(
      createHouseholdMeal(alder, {
        ...input,
        components: [
          { ingredientId: 'ing-tofu', totalQuantity: 400 },
          { ingredientId: 'ing-birch', totalQuantity: 10 },
          { ingredientId: 'ing-nobody', totalQuantity: 10 },
        ],
      }),
    )

    expect(error.reason).toBe('ingredientsNotFound')
    expect(error.missingIds).toEqual(['ing-birch', 'ing-nobody'])
    expect(await prisma.meal.count()).toBe(before)
  })
})

describe('getHouseholdMeal', () => {
  it('answers in the household locale, with ingredient macros and the favourite flag', async () => {
    const { alder } = await world()
    await prisma.favoriteMeal.create({ data: { householdId: alder, mealId: 'meal-curry' } })

    const meal = await getHouseholdMeal(alder, 'meal-curry', 'et')

    expect(meal).toMatchObject({
      id: 'meal-curry',
      name: 'Kanakarri',
      description: 'Mahe',
      // No Estonian notes, so the stored ones stand.
      preparationNotes: 'Simmer slowly',
      servings: 4,
      isFavorite: true,
      deletedAt: null,
      nutrition: { calories: 250, protein: 50, carbs: 25, fat: 13 },
    })
    expect(meal.components[0]!.ingredient).toEqual({
      id: 'ing-chicken',
      name: 'Kana',
      category: 'protein',
      defaultUnit: 'g',
      measuredByVolume: false,
      pieceDisplay: 'none',
      gramsPerPiece: null,
      calories: 100,
      protein: 31,
      carbs: 10,
      fat: 5,
    })
  })

  it('still returns a deleted meal, with its deletedAt', async () => {
    const { alder } = await world()

    const meal = await getHouseholdMeal(alder, 'meal-soup', 'en')

    expect(meal.deletedAt).toEqual(new Date('2026-10-01T12:00:00Z'))
  })

  it("answers mealNotFound for another household's meal, a library meal and an unknown id", async () => {
    const { alder } = await world()

    expect(await reasonOf(getHouseholdMeal(alder, 'meal-birch', 'en'))).toBe('mealNotFound')
    expect(await reasonOf(getHouseholdMeal(alder, 'meal-library', 'en'))).toBe('mealNotFound')
    expect(await reasonOf(getHouseholdMeal(alder, 'meal-nobody', 'en'))).toBe('mealNotFound')
  })
})

describe('updateHouseholdMeal', () => {
  it('writes the fields it is sent and leaves the rest', async () => {
    const { alder } = await world()

    const { meal } = await updateHouseholdMeal(alder, 'meal-curry', {
      sourceUrl: null,
      kidFriendly: true,
      suitableFor: ['lunch', 'dinner'],
    })

    const row = await prisma.meal.findUniqueOrThrow({ where: { id: 'meal-curry' } })
    expect(row).toMatchObject({
      name: 'Chicken curry',
      sourceUrl: null,
      kidFriendly: true,
      suitableFor: ['lunch', 'dinner'],
      servings: 4,
    })
    expect(meal).toMatchObject({ id: 'meal-curry', sourceUrl: null, isCustom: true })
    expect(await componentsOf('meal-curry')).toEqual(['ing-chicken=150', 'ing-rice=100'])
  })

  it('rewrites the components under the servings sent, and re-derives the protein', async () => {
    const { alder } = await world()

    const { meal } = await updateHouseholdMeal(alder, 'meal-curry', {
      servings: 2,
      components: [
        { ingredientId: 'ing-tofu', totalQuantity: 500 },
        { ingredientId: 'ing-rice', totalQuantity: 200, isVague: false, originalPhrase: '1 cup' },
      ],
    })

    expect(await componentsOf('meal-curry')).toEqual(['ing-rice=100', 'ing-tofu=250'])
    const row = await prisma.meal.findUniqueOrThrow({ where: { id: 'meal-curry' } })
    expect(row).toMatchObject({ servings: 2, primaryProteinType: 'legume' })
    expect(meal.allergens).toEqual(['soy'])
    const rice = await prisma.mealComponent.findFirstOrThrow({
      where: { mealId: 'meal-curry', ingredientId: 'ing-rice' },
    })
    expect(rice.originalPhrase).toBe('1 cup')
  })

  it('scales components sent without servings against the stored servings', async () => {
    const { alder } = await world()

    await updateHouseholdMeal(alder, 'meal-curry', {
      components: [
        { ingredientId: 'ing-chicken', totalQuantity: 800 },
        { ingredientId: 'ing-rice', totalQuantity: 400 },
      ],
    })

    expect(await componentsOf('meal-curry')).toEqual(['ing-chicken=200', 'ing-rice=100'])
  })

  it('restates the rows under new servings for a servings-only edit, keeping the totals', async () => {
    const { alder } = await world()

    await updateHouseholdMeal(alder, 'meal-curry', { servings: 6 })

    // 600 g chicken and 400 g rice, now over 6.
    expect(await componentsOf('meal-curry')).toEqual([
      'ing-chicken=100',
      'ing-rice=66.66666666666667',
    ])
  })

  it('leaves a vague row at 0 when servings change', async () => {
    const { alder } = await world()
    await prisma.mealComponent.update({
      where: { mealId_ingredientId: { mealId: 'meal-curry', ingredientId: 'ing-rice' } },
      data: { quantityPerServing: 0, isVague: true },
    })

    await updateHouseholdMeal(alder, 'meal-curry', { servings: 2 })

    expect(await componentsOf('meal-curry')).toEqual(['ing-chicken=300', 'ing-rice=0'])
  })

  describe('cached preparation tips', () => {
    it.each<[string, HouseholdMealPatch]>([
      ['a name change', { name: 'Chicken tikka' }],
      ['a timeMinutes change', { timeMinutes: 25 }],
      ['a preparationNotes change', { preparationNotes: 'Simmer fast' }],
      [
        'a component quantity change',
        {
          components: [
            { ingredientId: 'ing-chicken', totalQuantity: 700 },
            { ingredientId: 'ing-rice', totalQuantity: 400 },
          ],
        },
      ],
      [
        'a component swap',
        {
          components: [
            { ingredientId: 'ing-tofu', totalQuantity: 600 },
            { ingredientId: 'ing-rice', totalQuantity: 400 },
          ],
        },
      ],
      ['a servings-only edit, through the restated rows', { servings: 2 }],
      [
        'a servings edit sent by the form, through the quantities',
        { ...CURRY_AS_STORED, servings: 2 },
      ],
    ])('clears them for %s', async (_label, patch) => {
      const { alder } = await world()

      await updateHouseholdMeal(alder, 'meal-curry', patch)

      expect(await tipsOf()).toBeNull()
    })

    it.each<[string, HouseholdMealPatch]>([
      ['a sourceUrl-only change', { sourceUrl: 'https://example.com/other' }],
      ['a description and kidFriendly change', { description: 'Hot', kidFriendly: true }],
      ['a suitableFor change', { suitableFor: ['lunch' as const] }],
      ['servings resent at the stored value', { servings: 4 }],
      ['every stored value resent unchanged', CURRY_AS_STORED],
    ])('keeps them for %s', async (_label, patch) => {
      const { alder } = await world()

      await updateHouseholdMeal(alder, 'meal-curry', patch)

      expect(await tipsOf()).toBe(TIPS)
    })

    it('keeps them for a servings change on a meal of vague components only', async () => {
      const { alder } = await world()
      await prisma.mealComponent.updateMany({
        where: { mealId: 'meal-curry' },
        data: { quantityPerServing: 0, isVague: true },
      })

      await updateHouseholdMeal(alder, 'meal-curry', { servings: 2 })

      expect(await tipsOf()).toBe(TIPS)
    })
  })

  describe('meal image', () => {
    const cleared = { imageUrl: null, imageStatus: 'none', imageHue: null }
    const kept = { imageUrl: CURRY_IMAGE, imageStatus: 'ready', imageHue: 30 }

    it.each<[string, HouseholdMealPatch]>([
      ['a name change', { name: 'Chicken tikka' }],
      ['a description change', { description: 'Hot' }],
      ['a preparationNotes change', { preparationNotes: 'Simmer fast' }],
      [
        'a quantity change that reorders the ingredients',
        {
          components: [
            { ingredientId: 'ing-chicken', totalQuantity: 600 },
            { ingredientId: 'ing-rice', totalQuantity: 800 },
          ],
        },
      ],
    ])('clears it, and returns its URL, for %s', async (_label, patch) => {
      const { alder } = await world()

      const { discardedImageUrl } = await updateHouseholdMeal(alder, 'meal-curry', patch)

      expect(discardedImageUrl).toBe(CURRY_IMAGE)
      expect(await imageOf('meal-curry')).toEqual(cleared)
    })

    it.each<[string, HouseholdMealPatch]>([
      ['a servings-only edit', { servings: 2 }],
      ['a servings edit sent by the form', { ...CURRY_AS_STORED, servings: 2 }],
      ['every stored value resent unchanged', CURRY_AS_STORED],
      [
        'a sourceUrl, timeMinutes and kidFriendly change',
        { sourceUrl: null, timeMinutes: 5, kidFriendly: true },
      ],
    ])('keeps it for %s', async (_label, patch) => {
      const { alder } = await world()

      const { discardedImageUrl } = await updateHouseholdMeal(alder, 'meal-curry', patch)

      expect(discardedImageUrl).toBeNull()
      expect(await imageOf('meal-curry')).toEqual(kept)
    })

    // The omelette is 2 eggs (100 g) and 30 g cheese for 1, so it ranks
    // egg, cheese by weight but cheese, egg by raw count.
    it('keeps it when raw counts reorder but weights do not', async () => {
      const { alder } = await world()

      const { discardedImageUrl } = await updateHouseholdMeal(alder, 'meal-omelette', {
        components: [
          { ingredientId: 'ing-egg', totalQuantity: 1 },
          { ingredientId: 'ing-cheese', totalQuantity: 20 },
        ],
      })

      expect(discardedImageUrl).toBeNull()
      expect((await imageOf('meal-omelette')).imageStatus).toBe('ready')
    })

    it('clears it when weights reorder but raw counts do not', async () => {
      const { alder } = await world()

      const { discardedImageUrl } = await updateHouseholdMeal(alder, 'meal-omelette', {
        components: [
          { ingredientId: 'ing-egg', totalQuantity: 2 },
          { ingredientId: 'ing-cheese', totalQuantity: 150 },
        ],
      })

      expect(discardedImageUrl).toBe('https://store.example/meals/meal-omelette.png')
      expect((await imageOf('meal-omelette')).imageStatus).toBe('none')
    })
  })

  it("answers mealNotFound for another household's, a library, a deleted or an unknown meal, and writes nothing", async () => {
    const { alder } = await world()

    for (const id of ['meal-birch', 'meal-library', 'meal-soup', 'meal-nobody']) {
      expect(await reasonOf(updateHouseholdMeal(alder, id, { name: 'Renamed' }))).toBe(
        'mealNotFound',
      )
    }
    expect(await prisma.meal.count({ where: { name: 'Renamed' } })).toBe(0)
  })

  it("refuses an unknown or another household's ingredient, names both, and writes nothing", async () => {
    const { alder } = await world()

    const error = await refusalOf(
      updateHouseholdMeal(alder, 'meal-curry', {
        name: 'Renamed',
        components: [
          { ingredientId: 'ing-birch', totalQuantity: 10 },
          { ingredientId: 'ing-chicken', totalQuantity: 10 },
          { ingredientId: 'ing-nobody', totalQuantity: 10 },
        ],
      }),
    )

    expect(error.reason).toBe('ingredientsNotFound')
    expect(error.missingIds).toEqual(['ing-birch', 'ing-nobody'])
    expect((await prisma.meal.findUniqueOrThrow({ where: { id: 'meal-curry' } })).name).toBe(
      'Chicken curry',
    )
    expect(await componentsOf('meal-curry')).toEqual(['ing-chicken=150', 'ing-rice=100'])
    expect(await tipsOf()).toBe(TIPS)
  })
})

describe('deleteHouseholdMeal', () => {
  it('soft-deletes the meal, keeps its image for a restore, and leaves its plan entries pointing at it', async () => {
    const { alder } = await world()

    const deleted = await deleteHouseholdMeal(alder, 'meal-curry')

    const row = await prisma.meal.findUniqueOrThrow({ where: { id: 'meal-curry' } })
    expect(row.deletedAt).toBeInstanceOf(Date)
    expect(deleted).toEqual({ id: 'meal-curry', name: 'Chicken curry', deletedAt: row.deletedAt })
    expect(row).toMatchObject({ imageUrl: CURRY_IMAGE, imageStatus: 'ready' })
    const entry = await prisma.mealPlanEntry.findUniqueOrThrow({ where: { id: 'entry-curry' } })
    expect(entry).toMatchObject({ mealId: 'meal-curry', preparationTips: TIPS })
    expect(await componentsOf('meal-curry')).toEqual(['ing-chicken=150', 'ing-rice=100'])
  })

  it("answers mealNotFound for another household's, a library, a deleted or an unknown meal, and writes nothing", async () => {
    const { alder } = await world()

    for (const id of ['meal-birch', 'meal-library', 'meal-soup', 'meal-nobody']) {
      expect(await reasonOf(deleteHouseholdMeal(alder, id))).toBe('mealNotFound')
    }
    const rows = await prisma.meal.findMany({
      where: { id: { in: ['meal-birch', 'meal-library', 'meal-soup'] } },
      select: { id: true, deletedAt: true },
      orderBy: { id: 'asc' },
    })
    expect(rows).toEqual([
      { id: 'meal-birch', deletedAt: null },
      { id: 'meal-library', deletedAt: null },
      { id: 'meal-soup', deletedAt: new Date('2026-10-01T12:00:00Z') },
    ])
  })
})
