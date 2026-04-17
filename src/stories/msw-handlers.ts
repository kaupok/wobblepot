import { delay, http, HttpResponse, type HttpHandler } from 'msw'
import { MealType, type ProteinType } from '@/generated/prisma/enums'
import type { AlternativeMeal, MealComponent, NutritionData } from '@/components/meal-plan/types'
import type { PantryItemData } from '@/components/pantry/PantryItem'
import type { IngredientResult } from '@/components/household/meal-form-types'
import type { Member } from '@/types/member'
import {
  createChildMember,
  createManualMemberWithInvite,
  createMealComponent,
  createMember,
  createMemberInvite,
  ingredientResults,
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
  http.patch('/api/meal-plans/:planId/entries/:entryId', () => HttpResponse.json({ ok: true })),
  http.get('/api/households/me/meals', () =>
    HttpResponse.json({ meals: householdMeals, nextCursor: null }),
  ),
  http.post('/api/households/me/meals', () => HttpResponse.json({ id: 'new-meal-123' })),
  http.post('/api/meal-plans/:planId/shopping-list/purchase', () =>
    HttpResponse.json({ ok: true }),
  ),
  http.post('/api/meal-plans/:planId/shopping-list/unpurchase', () =>
    HttpResponse.json({ ok: true }),
  ),
  http.post('/api/shopping-list/custom', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { name?: string }
    const name = body.name ?? 'New item'
    return HttpResponse.json({
      item: {
        id: `custom-${Date.now()}`,
        name,
        checked: false,
        ingredientId: null,
        ingredient: null,
        createdAt: new Date().toISOString(),
      },
    })
  }),
  // Household members CRUD — used by `MemberList` (GET) and the dialogs (POST/PATCH/DELETE).
  http.get('/api/households/me/members', () => HttpResponse.json({ members: defaultMembers })),
  http.post('/api/households/me/members', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string
      preferences?: { displayName?: string | null; portionMultiplier?: number }
    }
    const newMember = createMember({
      id: `member-${Date.now()}`,
      userId: null,
      name: body.name ?? 'New member',
      role: 'member',
      user: null,
      preferences: {
        displayName: body.preferences?.displayName ?? null,
        portionMultiplier: body.preferences?.portionMultiplier ?? 1.0,
        targetCalories: null,
        targetProtein: null,
        targetCarbs: null,
        targetFat: null,
        dietaryType: null,
        allergens: [],
        restrictions: [],
        excludedIngredients: [],
        excludedIngredientIds: [],
      },
    })
    return HttpResponse.json(newMember)
  }),
  http.patch('/api/households/me/members/:id', async ({ request, params }) => {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string
      preferences?: Partial<{
        displayName: string | null
        portionMultiplier: number
      }>
    }
    return HttpResponse.json(
      createMember({
        id: String(params.id),
        name: body.name ?? 'Member',
        preferences: {
          displayName: body.preferences?.displayName ?? null,
          portionMultiplier: body.preferences?.portionMultiplier ?? 1.0,
          targetCalories: null,
          targetProtein: null,
          targetCarbs: null,
          targetFat: null,
          dietaryType: null,
          allergens: [],
          restrictions: [],
          excludedIngredients: [],
          excludedIngredientIds: [],
        },
      }),
    )
  }),
  http.delete('/api/households/me/members/:id', () => HttpResponse.json({ ok: true })),
  http.post('/api/households/me/invites', () => {
    const invite = createMemberInvite()
    return HttpResponse.json(invite)
  }),
  // Ingredient catalog search — used by `IngredientSearch` and indirectly by `MealForm`.
  http.get('/api/ingredients', ({ request }) => {
    const url = new URL(request.url)
    const search = url.searchParams.get('search')?.toLowerCase().trim() ?? ''
    const all = Object.values(ingredientResults)
    const filtered = search
      ? all.filter((ing) => ing.name.toLowerCase().includes(search))
      : all.slice(0, 5)
    return HttpResponse.json({ ingredients: filtered })
  }),
  // Favorite toggling on the meal library — used by `MealList`.
  http.post('/api/meals/:id/favorite', () => HttpResponse.json({ ok: true })),
  http.delete('/api/meals/:id/favorite', () => HttpResponse.json({ ok: true })),
  http.delete('/api/households/me/meals/:id', () => HttpResponse.json({ ok: true })),
  // Pantry CRUD — used by `InlineAddItem` (POST), `PantryItem` (PATCH for
  // toggle-staple, DELETE for remove), and `PantryList` (both, via children).
  http.post('/api/pantry', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      ingredientId?: string
      isStaple?: boolean
    }
    const ingredientId = body.ingredientId ?? 'new-ingredient'
    const catalogEntry: IngredientResult | undefined = (
      ingredientResults as Record<string, IngredientResult>
    )[ingredientId]
    const ingredient: PantryItemData['ingredient'] = catalogEntry
      ? {
          id: catalogEntry.id,
          name: catalogEntry.name,
          category: catalogEntry.category,
          defaultUnit: catalogEntry.defaultUnit,
        }
      : {
          id: ingredientId,
          name: ingredientId,
          category: 'condiment',
          defaultUnit: 'g',
        }
    const item: PantryItemData = {
      id: `pantry-${ingredientId}-${Date.now()}`,
      ingredient,
      quantity: null,
      isStaple: body.isStaple ?? false,
      updatedAt: new Date().toISOString(),
    }
    return HttpResponse.json(item)
  }),
  http.patch('/api/pantry/:id', () => HttpResponse.json({ ok: true })),
  http.delete('/api/pantry/:id', () => HttpResponse.json({ ok: true })),
]

/**
 * Default member roster used by `MemberList` and the member dialogs — owner +
 * one adult member + one child + one pending-invite member, so a single render
 * shows every badge/avatar variant the cards can produce.
 */
const defaultMembers: Member[] = [
  createMember(),
  createMember({
    id: 'member-2',
    userId: 'user-2',
    name: 'Sky Doe',
    role: 'member',
    user: { id: 'user-2', name: 'Sky Doe', email: 'sky@example.com', image: null },
  }),
  createChildMember(),
  createManualMemberWithInvite(),
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
  http.post('/api/meal-plans/:planId/shopping-list/purchase', () =>
    HttpResponse.json({ error: 'Failed to update item' }, { status: 500 }),
  ),
  http.post('/api/meal-plans/:planId/shopping-list/unpurchase', () =>
    HttpResponse.json({ error: 'Failed to update item' }, { status: 500 }),
  ),
  http.post('/api/shopping-list/custom', () =>
    HttpResponse.json({ error: 'Failed to add item' }, { status: 500 }),
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

/**
 * Override `GET /api/households/me/members` with an empty roster. Use for the
 * `MemberList` empty-state story.
 */
export const emptyMembersHandlers: HttpHandler[] = [
  http.get('/api/households/me/members', () => HttpResponse.json({ members: [] })),
]

/**
 * Override `GET /api/households/me/members` with a 500 error. Use for the
 * `MemberList` error-state story.
 */
export const errorMembersHandlers: HttpHandler[] = [
  http.get('/api/households/me/members', () =>
    HttpResponse.json({ error: 'Failed to fetch members' }, { status: 500 }),
  ),
]

/**
 * Override `GET /api/households/me/members` so it never resolves. Use for the
 * `MemberList` loading-state story (renders the skeleton).
 */
export const loadingMembersHandlers: HttpHandler[] = [
  http.get('/api/households/me/members', async () => {
    await delay('infinite')
    return HttpResponse.json({ members: [] })
  }),
]

/**
 * Override `POST /api/households/me/members` with a 500. Use to exercise the
 * `AddMemberDialog` error path.
 */
export const errorAddMemberHandlers: HttpHandler[] = [
  http.post('/api/households/me/members', () =>
    HttpResponse.json({ error: 'A member with that name already exists' }, { status: 400 }),
  ),
]

/**
 * Hold the `POST /api/households/me/members` request open so the dialog stays
 * in its `Submitting` state.
 */
export const submittingAddMemberHandlers: HttpHandler[] = [
  http.post('/api/households/me/members', async () => {
    await delay('infinite')
    return HttpResponse.json({ ok: true })
  }),
]

/**
 * Override `POST /api/households/me/invites` with a 500. Use for the
 * `MemberInviteDialog` error story.
 */
export const errorInviteHandlers: HttpHandler[] = [
  http.post('/api/households/me/invites', () =>
    HttpResponse.json({ error: 'Failed to create invite' }, { status: 500 }),
  ),
]

/**
 * Hold the `POST /api/households/me/invites` request open so the dialog stays
 * in its create-pending state.
 */
export const pendingInviteHandlers: HttpHandler[] = [
  http.post('/api/households/me/invites', async () => {
    await delay('infinite')
    return HttpResponse.json({})
  }),
]

/**
 * Override `GET /api/ingredients` to return an empty result set. Use for the
 * `IngredientSearch` no-results story.
 */
export const emptyIngredientsHandlers: HttpHandler[] = [
  http.get('/api/ingredients', () => HttpResponse.json({ ingredients: [] })),
]

/**
 * Hold `GET /api/ingredients` open so the spinner stays visible. Use for the
 * `IngredientSearch` typing-without-results story.
 */
export const loadingIngredientsHandlers: HttpHandler[] = [
  http.get('/api/ingredients', async () => {
    await delay('infinite')
    return HttpResponse.json({ ingredients: [] })
  }),
]

/**
 * Return 500 errors for pantry CRUD endpoints. Use for stories that exercise
 * the rollback / error-toast path on add / toggle-staple / remove.
 */
export const errorPantryHandlers: HttpHandler[] = [
  http.post('/api/pantry', () =>
    HttpResponse.json({ error: 'Failed to add item' }, { status: 500 }),
  ),
  http.patch('/api/pantry/:id', () =>
    HttpResponse.json({ error: 'Failed to update item' }, { status: 500 }),
  ),
  http.delete('/api/pantry/:id', () =>
    HttpResponse.json({ error: 'Failed to remove item' }, { status: 500 }),
  ),
]

/**
 * Return a 409 conflict for `POST /api/pantry`. The component surfaces this as
 * an "already in your pantry" toast without firing `onItemAdded`.
 */
export const conflictPantryHandlers: HttpHandler[] = [
  http.post('/api/pantry', () =>
    HttpResponse.json({ error: 'Already in pantry' }, { status: 409 }),
  ),
]

/**
 * Hold `POST /api/households/me/meals` and `PATCH /api/households/me/meals/:id`
 * open. Use for the `MealForm` submitting story.
 */
export const submittingMealFormHandlers: HttpHandler[] = [
  http.post('/api/households/me/meals', async () => {
    await delay('infinite')
    return HttpResponse.json({ id: 'new' })
  }),
  http.patch('/api/households/me/meals/:id', async () => {
    await delay('infinite')
    return HttpResponse.json({ ok: true })
  }),
]
