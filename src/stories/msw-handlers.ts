import { delay, http, HttpResponse, type HttpHandler } from 'msw'
import { MealType, type ProteinType } from '@/generated/prisma/enums'
import type { AlternativeMeal, MealComponent, NutritionData } from '@/components/meal-plan/types'
import {
  createMealComponent,
  lemonGarlicChickenComponents,
  misoSalmonAlternative,
} from './fixtures'

/**
 * Shape returned by `GET /api/meals`. Kept local because `MealSelectorModal`
 * defines it inline — duplicating here avoids coupling the mock layer to a
 * non-exported internal type.
 */
interface LibraryMeal {
  id: string
  name: string
  description: string | null
  timeMinutes: number | null
  kidFriendly: boolean
  primaryProteinType: ProteinType
  suitableFor: MealType[]
  isCustom: boolean
  isFavorite: boolean
  components: MealComponent[]
  nutrition: NutritionData
}

/**
 * Shape returned by `GET /api/households/me/meals` (the `MealData` used by
 * `RecipesPageClient` → `MealList`). Duplicated for the same reason as
 * `LibraryMeal` above.
 */
interface HouseholdMeal extends LibraryMeal {
  description: string | null
  preparationNotes: string | null
  sourceUrl: string | null
  servings: number
  createdAt: string
  updatedAt: string
  allergens: string[]
}

function buildLibraryMeal(
  overrides: Partial<LibraryMeal> & Pick<LibraryMeal, 'id' | 'name'>,
): LibraryMeal {
  return {
    description: null,
    timeMinutes: 45,
    kidFriendly: true,
    primaryProteinType: 'poultry',
    suitableFor: [MealType.dinner],
    isCustom: false,
    isFavorite: false,
    components: lemonGarlicChickenComponents,
    nutrition: { calories: 520, protein: 42, carbs: 30, fat: 28 },
    ...overrides,
  }
}

function buildHouseholdMeal(
  overrides: Partial<HouseholdMeal> & Pick<HouseholdMeal, 'id' | 'name'>,
): HouseholdMeal {
  return {
    ...buildLibraryMeal(overrides),
    preparationNotes: null,
    sourceUrl: null,
    servings: 4,
    createdAt: '2026-04-01T12:00:00.000Z',
    updatedAt: '2026-04-01T12:00:00.000Z',
    allergens: [],
    isCustom: true,
    ...overrides,
  }
}

const libraryMeals: LibraryMeal[] = [
  buildLibraryMeal({
    id: 'meal-chicken',
    name: 'Lemon-garlic roast chicken',
    description: 'Weeknight-friendly sheet-pan dinner with crisp skin and bright citrus.',
  }),
  buildLibraryMeal({
    id: 'meal-salmon',
    name: 'Miso-glazed salmon with rice',
    description: 'Sweet-savoury broiled salmon with ginger rice and pickled cucumber.',
    primaryProteinType: 'fish',
    timeMinutes: 30,
    components: [
      createMealComponent({ ingredientId: 'salmon-fillet', quantityPerServing: 150 }),
      createMealComponent({ ingredientId: 'short-grain-rice', quantityPerServing: 75 }),
      createMealComponent({ ingredientId: 'miso-paste', quantityPerServing: 10 }),
    ],
    nutrition: { calories: 540, protein: 38, carbs: 55, fat: 18 },
  }),
  buildLibraryMeal({
    id: 'meal-lentil',
    name: 'Spiced red-lentil stew',
    description: 'One-pot weeknight stew with warming spices and coconut milk.',
    primaryProteinType: 'none',
    timeMinutes: 35,
    components: [createMealComponent({ ingredientId: 'potato', quantityPerServing: 180 })],
    nutrition: { calories: 410, protein: 18, carbs: 62, fat: 12 },
  }),
]

const householdMeals: HouseholdMeal[] = libraryMeals.map((meal) =>
  buildHouseholdMeal({ ...meal, isCustom: true }),
)

const defaultAlternatives: AlternativeMeal[] = [
  misoSalmonAlternative,
  {
    id: 'alt-2',
    name: 'Sheet-pan chicken fajitas',
    description: 'Weeknight fajitas with peppers, onions, and a quick chipotle yoghurt.',
    timeMinutes: 35,
    kidFriendly: true,
    primaryProteinType: 'poultry',
    suitableFor: [MealType.dinner],
    reason: 'Matches your preferences',
    components: lemonGarlicChickenComponents,
    nutrition: { calories: 480, protein: 38, carbs: 32, fat: 22 },
  },
  {
    id: 'alt-3',
    name: 'Tofu stir-fry with jasmine rice',
    description: 'Crispy tofu in ginger-soy glaze with quick-pickled vegetables.',
    timeMinutes: 25,
    kidFriendly: false,
    primaryProteinType: 'none',
    suitableFor: [MealType.dinner],
    reason: 'Balances your protein mix — fewer vegetables this week',
    components: lemonGarlicChickenComponents,
    nutrition: { calories: 460, protein: 22, carbs: 58, fat: 16 },
  },
]

/**
 * Default MSW handlers wired into every story via `parameters.msw.handlers.default`
 * in `.storybook/preview.tsx`. Per-story overrides can replace any of these by
 * re-declaring the same method+path under `parameters.msw.handlers`.
 */
export const defaultHandlers: HttpHandler[] = [
  http.get('/api/meals', () =>
    HttpResponse.json({
      meals: libraryMeals,
      total: libraryMeals.length,
      hasMore: false,
    }),
  ),
  http.post('/api/meal-plans/:planId/entries/:entryId/suggestions', () =>
    HttpResponse.json({ alternatives: defaultAlternatives }),
  ),
  http.post('/api/meal-plans/:planId/entries/:entryId/regenerate', () =>
    HttpResponse.json({ alternatives: defaultAlternatives }),
  ),
  http.get('/api/households/me/meals', () =>
    HttpResponse.json({ meals: householdMeals, nextCursor: null }),
  ),
]

/**
 * Return empty response bodies for the library and household meal endpoints.
 * Use in stories that exercise the component's empty state.
 */
export const emptyMealsHandlers: HttpHandler[] = [
  http.get('/api/meals', () => HttpResponse.json({ meals: [], total: 0, hasMore: false })),
  http.post('/api/meal-plans/:planId/entries/:entryId/suggestions', () =>
    HttpResponse.json({ alternatives: [] }),
  ),
  http.post('/api/meal-plans/:planId/entries/:entryId/regenerate', () =>
    HttpResponse.json({ alternatives: [] }),
  ),
  http.get('/api/households/me/meals', () => HttpResponse.json({ meals: [], nextCursor: null })),
]

/**
 * Return 500 errors for every data-fetching endpoint. Use in stories that
 * exercise the component's error state.
 */
export const errorMealsHandlers: HttpHandler[] = [
  http.get('/api/meals', () =>
    HttpResponse.json({ error: 'Failed to fetch meals' }, { status: 500 }),
  ),
  http.post('/api/meal-plans/:planId/entries/:entryId/suggestions', () =>
    HttpResponse.json({ error: 'Failed to generate suggestions' }, { status: 500 }),
  ),
  http.post('/api/meal-plans/:planId/entries/:entryId/regenerate', () =>
    HttpResponse.json({ error: 'Failed to regenerate' }, { status: 500 }),
  ),
  http.get('/api/households/me/meals', () =>
    HttpResponse.json({ error: 'Failed to fetch meals' }, { status: 500 }),
  ),
]

/**
 * Never resolve, keeping queries in their loading state indefinitely. Use in
 * stories that need to show the skeleton / spinner UI deterministically.
 */
export const loadingMealsHandlers: HttpHandler[] = [
  http.get('/api/meals', async () => {
    await delay('infinite')
    return HttpResponse.json({ meals: [], total: 0, hasMore: false })
  }),
  http.post('/api/meal-plans/:planId/entries/:entryId/suggestions', async () => {
    await delay('infinite')
    return HttpResponse.json({ alternatives: [] })
  }),
  http.post('/api/meal-plans/:planId/entries/:entryId/regenerate', async () => {
    await delay('infinite')
    return HttpResponse.json({ alternatives: [] })
  }),
  http.get('/api/households/me/meals', async () => {
    await delay('infinite')
    return HttpResponse.json({ meals: [], nextCursor: null })
  }),
]
