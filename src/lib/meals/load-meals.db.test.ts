import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import type { Allergen, MealType, ProteinType } from '@/generated/prisma/enums'
import { loadMeals, type LoadMealsFilters } from '@/lib/meals/load-meals'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks,
// so the filters, the pg_trgm search and the ordering run as in production.
// `GET /api/meals` and the MCP `list_meals` tool mock `loadMeals` at the seam.

/**
 * Alder sees four library meals, its own stew, and none of Birch's pie or the
 * deleted meal. The ingredients belong to Alder, so their names never clash
 * with the shared ingredient pool the migrations seed.
 */
async function world() {
  const alder = await prisma.household.create({ data: { name: 'Alder' } })
  const birch = await prisma.household.create({ data: { name: 'Birch' } })

  const ingredient = (
    id: string,
    name: string,
    nutrition: { calories: number; protein: number; carbs: number; fat: number },
    extra: { defaultUnit?: 'g' | 'piece'; gramsPerPiece?: number; allergens?: Allergen[] } = {},
  ) =>
    prisma.ingredient.create({
      data: {
        id,
        name,
        householdId: alder.id,
        category: 'protein',
        defaultUnit: 'g',
        ...nutrition,
        ...extra,
      },
    })
  await ingredient('ing-chicken', 'Chicken breast', {
    calories: 165,
    protein: 31,
    carbs: 0,
    fat: 3.6,
  })
  await ingredient(
    'ing-egg',
    'Egg',
    { calories: 155, protein: 13, carbs: 1.1, fat: 11 },
    { defaultUnit: 'piece', gramsPerPiece: 55, allergens: ['eggs'] },
  )
  await ingredient(
    'ing-oats',
    'Rolled oats',
    { calories: 380, protein: 13, carbs: 60, fat: 7 },
    { allergens: ['gluten'] },
  )
  await ingredient('ing-onion', 'Onion', { calories: 40, protein: 1, carbs: 9, fat: 0 })

  await meal('meal-stirfry', 'Chicken stir fry', {
    suitableFor: ['dinner'],
    primaryProteinType: 'poultry',
    kidFriendly: true,
    components: { 'ing-chicken': 150 },
  })
  await meal('meal-omelette', 'Omelette', {
    suitableFor: ['breakfast'],
    primaryProteinType: 'eggs',
    components: { 'ing-egg': 2 },
  })
  await meal('meal-porridge', 'Porridge', {
    suitableFor: ['breakfast'],
    components: { 'ing-oats': 60 },
  })
  await meal('meal-onion-soup', 'Onion soup', {
    suitableFor: ['dinner'],
    components: { 'ing-onion': 200 },
  })
  await meal('meal-alder', "Alder's stew", { householdId: alder.id, suitableFor: ['dinner'] })
  await meal('meal-birch', 'Birch pie', { householdId: birch.id })
  await meal('meal-deleted', 'Deleted chicken', { deletedAt: new Date() })

  return { alder: alder.id, birch: birch.id }
}

async function meal(
  id: string,
  name: string,
  {
    components = {},
    ...data
  }: {
    householdId?: string
    preparationNotes?: string
    suitableFor?: MealType[]
    primaryProteinType?: ProteinType
    kidFriendly?: boolean
    deletedAt?: Date
    imageStatus?: 'ready'
    imageUrl?: string
    imageHue?: number
    imagePromptVersion?: string
    components?: Record<string, number>
  } = {},
) {
  await prisma.meal.create({
    data: {
      id,
      name,
      ...data,
      components: {
        create: Object.entries(components).map(([ingredientId, quantityPerServing]) => ({
          ingredientId,
          quantityPerServing,
        })),
      },
    },
  })
}

const LIBRARY = ['Chicken stir fry', 'Omelette', 'Onion soup', 'Porridge']
const VISIBLE = ["Alder's stew", ...LIBRARY]

/** Alder in English with no preferences, unless `over` says otherwise. */
const load = (
  householdId: string,
  filters: LoadMealsFilters = {},
  over: Partial<Parameters<typeof loadMeals>[0]> = {},
) => loadMeals({ id: householdId, locale: 'en', preferences: null, ...over }, filters)

const names = (result: Awaited<ReturnType<typeof loadMeals>>) => result.meals.map((m) => m.name)

describe('loadMeals', () => {
  it("lists the library and the household's own meals by name, never another household's or a deleted one", async () => {
    const { alder } = await world()

    const result = await load(alder)

    expect(names(result)).toEqual(VISIBLE)
    expect(result.total).toBe(5)
    expect(result.hasMore).toBe(false)
  })

  it.each([
    ['system', LIBRARY],
    ['custom', ["Alder's stew"]],
  ] as const)('filters source=%s', async (source, expected) => {
    const { alder } = await world()

    expect(names(await load(alder, { source }))).toEqual(expected)
  })

  it("filters source=favorites to the household's favourites", async () => {
    const { alder, birch } = await world()
    await prisma.favoriteMeal.create({ data: { householdId: alder, mealId: 'meal-porridge' } })
    await prisma.favoriteMeal.create({ data: { householdId: birch, mealId: 'meal-omelette' } })

    expect(names(await load(alder, { source: 'favorites' }))).toEqual(['Porridge'])
  })

  it('marks custom and favourite meals', async () => {
    const { alder, birch } = await world()
    await prisma.favoriteMeal.create({ data: { householdId: alder, mealId: 'meal-alder' } })
    await prisma.favoriteMeal.create({ data: { householdId: birch, mealId: 'meal-porridge' } })

    const flags = Object.fromEntries(
      (await load(alder)).meals.map((m) => [m.id, [m.isCustom, m.isFavorite]]),
    )

    expect(flags['meal-alder']).toEqual([true, true])
    expect(flags['meal-porridge']).toEqual([false, false])
  })

  // HON-1352: the picker's cook view shows them, as My recipes' does.
  it("carries a recipe's own notes", async () => {
    const { alder } = await world()
    await prisma.meal.update({
      where: { id: 'meal-alder' },
      data: { preparationNotes: 'Brown the meat in two batches.' },
    })

    const byId = Object.fromEntries((await load(alder)).meals.map((m) => [m.id, m]))

    expect(byId['meal-alder']!.preparationNotes).toBe('Brown the meat in two batches.')
    expect(byId['meal-porridge']!.preparationNotes).toBeNull()
  })

  it('filters by meal type, protein type and kid-friendliness', async () => {
    const { alder } = await world()

    expect(names(await load(alder, { mealType: 'breakfast' }))).toEqual(['Omelette', 'Porridge'])
    expect(names(await load(alder, { proteinType: 'poultry' }))).toEqual(['Chicken stir fry'])
    expect(names(await load(alder, { kidFriendly: true }))).toEqual(['Chicken stir fry'])
  })

  it("hides meals with the household's allergens and excluded ingredients", async () => {
    const { alder } = await world()

    const result = await load(
      alder,
      {},
      { preferences: { allergensToAvoid: ['gluten'], excludedIngredients: ['onions'] } },
    )

    expect(names(result)).toEqual(["Alder's stew", 'Chicken stir fry', 'Omelette'])
    expect(result.total).toBe(3)
  })

  it('pages with limit and offset, and says whether more follow', async () => {
    const { alder } = await world()

    const middle = await load(alder, { limit: 2, offset: 2 })
    const last = await load(alder, { limit: 2, offset: 4 })

    expect(names(middle)).toEqual(['Omelette', 'Onion soup'])
    expect(middle).toMatchObject({ total: 5, hasMore: true })
    expect(names(last)).toEqual(['Porridge'])
    expect(last.hasMore).toBe(false)
  })

  it('computes nutrition per serving, converting pieces to grams', async () => {
    const { alder } = await world()

    const nutrition = Object.fromEntries((await load(alder)).meals.map((m) => [m.id, m.nutrition]))

    // 150 g chicken at 165 kcal/100 g = 247.5 → 248
    expect(nutrition['meal-stirfry']).toEqual({ calories: 248, protein: 47, carbs: 0, fat: 5 })
    // 2 eggs × 55 g = 110 g; 155 kcal/100 g → 170.5 → 171 (HON-713)
    expect(nutrition['meal-omelette']).toEqual({ calories: 171, protein: 14, carbs: 1, fat: 12 })
  })

  it('carries a current image and presents one at a stale prompt version as absent', async () => {
    const { alder } = await world()
    const ready = { imageStatus: 'ready', imageUrl: 'https://blob/a.png', imageHue: 42 } as const
    await meal('meal-current', 'Current', { ...ready, imagePromptVersion: 'v4' })
    await meal('meal-stale', 'Stale', { ...ready, imagePromptVersion: 'v3' })

    const images = Object.fromEntries(
      (await load(alder, { search: 'current' })).meals
        .concat((await load(alder, { search: 'stale' })).meals)
        .map((m) => [m.id, [m.imageStatus, m.imageUrl, m.imageHue]]),
    )

    expect(images['meal-current']).toEqual(['ready', 'https://blob/a.png', 42])
    expect(images['meal-stale']).toEqual(['none', null, null])
  })

  describe('search', () => {
    it("matches a meal's name, and never a deleted meal", async () => {
      const { alder } = await world()

      expect(names(await load(alder, { search: 'chicken' }))).toEqual(['Chicken stir fry'])
    })

    it("matches an ingredient's name", async () => {
      const { alder } = await world()

      expect(names(await load(alder, { search: 'rolled' }))).toEqual(['Porridge'])
    })

    it('forgives a typo from four characters', async () => {
      const { alder } = await world()

      expect(names(await load(alder, { search: 'omelete' }))).toEqual(['Omelette'])
    })

    // HON-942: one shared first letter used to match every meal with onion.
    it('matches a search shorter than four characters by substring only', async () => {
      const { alder } = await world()

      expect(names(await load(alder, { search: 'oat' }))).toEqual(['Porridge'])
      expect(names(await load(alder, { search: 'oni' }))).toEqual(['Onion soup'])
    })

    it('ranks a substring match above a fuzzy match', async () => {
      const { alder } = await world()
      await meal('meal-chickpea', 'Chickpea curry')
      await meal('meal-spicy', 'Spicy chicken')

      const result = await load(alder, { search: 'chicken', limit: 3 })

      // Alphabetically "Chickpea curry" would come first. Of the two substring
      // matches, the closer one ("Spicy chicken", the shorter name) leads.
      expect(names(result)).toEqual(['Spicy chicken', 'Chicken stir fry', 'Chickpea curry'])
    })

    it('takes % and _ in the search literally', async () => {
      const { alder } = await world()
      await meal('meal-rye', '50% rye bread')
      await meal('meal-pasta', '500 g pasta')

      expect(names(await load(alder, { search: '50%' }))).toEqual(['50% rye bread'])
    })

    it('pages the matches in rank order', async () => {
      const { alder } = await world()
      await meal('meal-chickpea', 'Chickpea curry')
      await meal('meal-spicy', 'Spicy chicken')

      const result = await load(alder, { search: 'chicken', limit: 1, offset: 1 })

      expect(names(result)).toEqual(['Chicken stir fry'])
      expect(result).toMatchObject({ total: 3, hasMore: true })
    })
  })

  // HON-911: an Estonian household searches and browses by the names it sees.
  describe('for a household on Estonian', () => {
    async function translate() {
      const meals: Record<string, string> = {
        'meal-stirfry': 'Kanawokk',
        'meal-omelette': 'Omlett',
        'meal-porridge': 'Kaerapuder',
        'meal-onion-soup': 'Sibulasupp',
        'meal-apple': 'Õunakook',
      }
      await meal('meal-apple', 'Apple pie')
      for (const [mealId, name] of Object.entries(meals)) {
        await prisma.mealTranslation.create({ data: { mealId, locale: 'et', name } })
      }
      await prisma.ingredientTranslation.create({
        data: { ingredientId: 'ing-chicken', locale: 'et', name: 'Kanarind' },
      })
    }

    it('orders the list by the Estonian names in Estonian order', async () => {
      const { alder } = await world()
      await translate()

      const all = await load(alder, {}, { locale: 'et' })
      const page = await load(alder, { limit: 2, offset: 4 }, { locale: 'et' })

      // A household meal has no translation and sorts by its own name; õ sorts after s.
      expect(names(all)).toEqual([
        "Alder's stew",
        'Kaerapuder',
        'Kanawokk',
        'Omlett',
        'Sibulasupp',
        'Õunakook',
      ])
      expect(names(page)).toEqual(['Sibulasupp', 'Õunakook'])
      expect(page).toMatchObject({ total: 6, hasMore: false })
    })

    it("matches the meal's translated name", async () => {
      const { alder } = await world()
      await translate()

      const result = await load(alder, { search: 'kanawokk' }, { locale: 'et' })

      expect(names(result)).toEqual(['Kanawokk'])
    })

    it("matches an ingredient's translated name, and shows it", async () => {
      const { alder } = await world()
      await translate()

      const result = await load(alder, { search: 'kanarind' }, { locale: 'et' })

      expect(names(result)).toEqual(['Kanawokk'])
      expect(result.meals[0]!.components[0]!.ingredient.name).toBe('Kanarind')
    })

    it('never matches a translated name for an English household', async () => {
      const { alder } = await world()
      await translate()

      expect(names(await load(alder, { search: 'kanawokk' }))).toEqual([])
    })
  })
})
