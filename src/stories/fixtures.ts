import { MealType, type IngredientCategory } from '@/generated/prisma/enums'
import type { MealCardBaseData } from '@/components/meal-plan/MealCardBase'
import type {
  AlternativeMeal,
  ExpectedMealTypes,
  MealComponent,
  MealData,
  PantryIngredient,
  PantryItemFull,
  PlanEntry,
  TimelineDay,
} from '@/components/meal-plan/types'
import type {
  IngredientAlternative,
  IngredientResult,
  MealComponent as MealFormComponent,
  PrefilledIngredient,
} from '@/components/household/meal-form-types'
import type { MealData as HouseholdMealData } from '@/components/household/MealList'
import type { PantryItemData } from '@/components/pantry/PantryItem'
import type { ReviewMealData } from '@/components/recipes/ImagineReviewDialog'
import type {
  LowConfidenceIngredientData,
  MatchedIngredientData,
  UnmatchedIngredientData,
} from '@/components/recipes/IngredientRow'
import type { CustomItemData } from '@/components/shopping/CustomItemInput'
import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'
import type { UrgencyBucket } from '@/lib/meal-planning/dates'
import type { Session } from '@/lib/auth'
import type { Member, MemberInvite, MemberPreferences } from '@/types/member'

type IngredientShape = MealComponent['ingredient']
type PantryItemIngredient = PantryItemFull['ingredient']

/**
 * Build a Better Auth session fixture for navigation / header stories. Fixed
 * ids and dates so axe snapshots stay deterministic. Override any field to
 * model a specific user or session-state variant.
 */
export function createSession(overrides: Partial<Session> = {}): Session {
  const createdAt = new Date('2026-01-15T12:00:00.000Z')
  return {
    session: {
      id: 'session-storybook',
      userId: 'user-storybook',
      expiresAt: new Date('2026-12-31T23:59:59.000Z'),
      token: 'storybook-session-token',
      ipAddress: '127.0.0.1',
      userAgent: 'Storybook',
      createdAt,
      updatedAt: createdAt,
    },
    user: {
      id: 'user-storybook',
      email: 'alex@example.com',
      name: 'Alex Doe',
      emailVerified: true,
      image: null,
      createdAt,
      updatedAt: createdAt,
    },
    ...overrides,
  }
}

/** Default authenticated session — canonical user for nav stories. */
export const sessionFixture: Session = createSession()

/**
 * Canonical ingredient catalog used across meal-plan stories. Keyed by id so
 * factories can look up the matching ingredient sub-object when you pass just
 * an `ingredientId` override.
 */
export const ingredients = {
  'chicken-thigh': {
    id: 'chicken-thigh',
    name: 'Chicken thigh',
    category: 'protein',
    defaultUnit: 'g',
    gramsPerPiece: null,
  },
  potato: {
    id: 'potato',
    name: 'Potato',
    category: 'produce',
    defaultUnit: 'g',
    gramsPerPiece: null,
  },
  lemon: {
    id: 'lemon',
    name: 'Lemon',
    category: 'produce',
    defaultUnit: 'piece',
    gramsPerPiece: 60,
  },
  garlic: {
    id: 'garlic',
    name: 'Garlic',
    category: 'aromatic',
    defaultUnit: 'piece',
    gramsPerPiece: 5,
  },
  'olive-oil': {
    id: 'olive-oil',
    name: 'Olive oil',
    category: 'pantry',
    defaultUnit: 'g',
    gramsPerPiece: null,
  },
  'salmon-fillet': {
    id: 'salmon-fillet',
    name: 'Salmon fillet',
    category: 'protein',
    defaultUnit: 'g',
    gramsPerPiece: null,
  },
  'short-grain-rice': {
    id: 'short-grain-rice',
    name: 'Short-grain rice',
    category: 'grain',
    defaultUnit: 'g',
    gramsPerPiece: null,
  },
  'miso-paste': {
    id: 'miso-paste',
    name: 'White miso',
    category: 'pantry',
    defaultUnit: 'g',
    gramsPerPiece: null,
  },
  salt: {
    id: 'salt',
    name: 'Salt',
    category: 'pantry',
    defaultUnit: 'g',
    gramsPerPiece: null,
  },
} as const satisfies Record<string, IngredientShape>

/**
 * Build an ingredient sub-object. Defaults to chicken thigh; pass overrides to
 * customize any field. Use {@link ingredients} when you just need a named lookup.
 */
export function createIngredient(overrides: Partial<IngredientShape> = {}): IngredientShape {
  return { ...ingredients['chicken-thigh'], ...overrides }
}

/**
 * Build a `MealComponent`. If `ingredientId` matches a key in {@link ingredients},
 * the matching ingredient sub-object is used automatically — pass `ingredient`
 * explicitly to override. Defaults to 150g chicken thigh per serving.
 */
export function createMealComponent(overrides: Partial<MealComponent> = {}): MealComponent {
  const ingredientId = overrides.ingredientId ?? 'chicken-thigh'
  const catalogEntry = (ingredients as Record<string, IngredientShape>)[ingredientId]
  const ingredient = overrides.ingredient ?? catalogEntry ?? createIngredient({ id: ingredientId })
  return {
    ingredientId,
    quantityPerServing: 150,
    ...overrides,
    ingredient,
  }
}

/**
 * Canonical 4-component ingredient list for the lemon-garlic roast chicken
 * scenario — matches what story files used inline before the extraction.
 */
export const lemonGarlicChickenComponents: MealComponent[] = [
  createMealComponent({ ingredientId: 'chicken-thigh', quantityPerServing: 150 }),
  createMealComponent({ ingredientId: 'potato', quantityPerServing: 200 }),
  createMealComponent({ ingredientId: 'lemon', quantityPerServing: 0.5 }),
  createMealComponent({ ingredientId: 'garlic', quantityPerServing: 2 }),
]

/**
 * Extended lemon-garlic chicken components including olive oil — used by
 * `MealCardBase` stories that exercise pantry-staple availability.
 */
export const lemonGarlicChickenComponentsWithOil: MealComponent[] = [
  createMealComponent({ ingredientId: 'chicken-thigh', quantityPerServing: 150 }),
  createMealComponent({ ingredientId: 'garlic', quantityPerServing: 2 }),
  createMealComponent({ ingredientId: 'lemon', quantityPerServing: 1 }),
  createMealComponent({ ingredientId: 'olive-oil', quantityPerServing: 15 }),
]

/**
 * Full 5-component lemon-garlic chicken — used by `MealDetail` stories that
 * render the complete ingredient breakdown.
 */
export const lemonGarlicChickenComponentsFull: MealComponent[] = [
  createMealComponent({ ingredientId: 'chicken-thigh', quantityPerServing: 150 }),
  createMealComponent({ ingredientId: 'potato', quantityPerServing: 200 }),
  createMealComponent({ ingredientId: 'lemon', quantityPerServing: 0.5 }),
  createMealComponent({ ingredientId: 'garlic', quantityPerServing: 2 }),
  createMealComponent({ ingredientId: 'olive-oil', quantityPerServing: 15 }),
]

/**
 * Build a `MealData`. Default = lemon-garlic roast chicken, kid-friendly,
 * 45 min, 4 components (chicken, potato, lemon, garlic). Override any field
 * to build a different meal.
 */
export function createMeal(overrides: Partial<MealData> = {}): MealData {
  return {
    id: 'meal-1',
    name: 'Lemon-garlic roast chicken',
    kidFriendly: true,
    timeMinutes: 45,
    preparationNotes: null,
    components: lemonGarlicChickenComponents,
    nutrition: { calories: 520, protein: 42, carbs: 30, fat: 28 },
    ...overrides,
  }
}

/**
 * Build `MealCardBaseData` — the superset shape used by the shared meal card
 * (name + description + sourceUrl + primaryProteinType + suitableFor + etc.).
 * Default = lemon-garlic roast chicken with olive oil, poultry, dinner-only.
 */
export function createMealCardBaseData(
  overrides: Partial<MealCardBaseData> = {},
): MealCardBaseData {
  return {
    name: 'Lemon-garlic roast chicken',
    description: 'Weeknight-friendly sheet-pan dinner with crisp skin and bright citrus.',
    sourceUrl: null,
    timeMinutes: 45,
    kidFriendly: true,
    primaryProteinType: 'poultry',
    suitableFor: [MealType.dinner],
    components: lemonGarlicChickenComponentsWithOil,
    nutrition: { calories: 520, protein: 42, carbs: 8, fat: 35 },
    ...overrides,
  }
}

/**
 * Build a `PantryItemFull`. Default = 800g of chicken thigh, not a staple.
 * Pass `ingredientId` to pick from the shared ingredient catalog.
 */
export function createPantryItem(overrides: Partial<PantryItemFull> = {}): PantryItemFull {
  const ingredientId = overrides.ingredientId ?? 'chicken-thigh'
  const catalogEntry = (ingredients as Record<string, IngredientShape>)[ingredientId]
  const baseIngredient: PantryItemIngredient = catalogEntry
    ? {
        id: catalogEntry.id,
        name: catalogEntry.name,
        category: catalogEntry.category,
        defaultUnit: catalogEntry.defaultUnit,
      }
    : {
        id: ingredientId,
        name: ingredientId,
        category: 'other',
        defaultUnit: 'g',
      }
  return {
    id: `p-${ingredientId}`,
    ingredientId,
    quantity: 800,
    isStaple: false,
    ...overrides,
    ingredient: overrides.ingredient ?? baseIngredient,
  }
}

/**
 * Pantry availability matching the lemon-garlic chicken scenario — chicken
 * on hand (not a staple) + garlic (staple). Covers the "partial pantry"
 * default used by most stories.
 */
export const lemonGarlicChickenPantry: PantryIngredient[] = [
  { ingredientId: 'chicken-thigh', isStaple: false },
  { ingredientId: 'garlic', isStaple: true },
]

/**
 * Extended pantry for stories that also exercise olive oil as a staple
 * (MealDetail, MealDetailModal).
 */
export const lemonGarlicChickenPantryWithOil: PantryIngredient[] = [
  { ingredientId: 'chicken-thigh', isStaple: false },
  { ingredientId: 'garlic', isStaple: true },
  { ingredientId: 'olive-oil', isStaple: true },
]

/**
 * Full pantry items (with quantities) matching the lemon-garlic scenario —
 * used by MealCard to render availability indicators with real quantities.
 */
export const lemonGarlicChickenPantryItems: PantryItemFull[] = [
  createPantryItem({ ingredientId: 'chicken-thigh', quantity: 800, isStaple: false }),
  createPantryItem({ ingredientId: 'garlic', quantity: 10, isStaple: true }),
]

type PantryIngredientShape = PantryItemData['ingredient']

/**
 * Strictly-typed ingredient catalog for pantry-module fixtures. The
 * `PantryItemData.ingredient` shape requires a valid `IngredientCategory` enum
 * value, so we keep a narrower lookup here instead of reusing the loose-typed
 * meal-plan `ingredients` catalog above.
 */
const pantryIngredients = {
  'olive-oil': {
    id: 'olive-oil',
    name: 'Olive oil',
    category: 'fat',
    defaultUnit: 'g',
  },
  salt: {
    id: 'salt',
    name: 'Salt',
    category: 'condiment',
    defaultUnit: 'g',
  },
  'chicken-thigh': {
    id: 'chicken-thigh',
    name: 'Chicken thigh',
    category: 'protein',
    defaultUnit: 'g',
  },
  'short-grain-rice': {
    id: 'short-grain-rice',
    name: 'Short-grain rice',
    category: 'carb',
    defaultUnit: 'g',
  },
  garlic: {
    id: 'garlic',
    name: 'Garlic',
    category: 'vegetable',
    defaultUnit: 'piece',
  },
  lemon: {
    id: 'lemon',
    name: 'Lemon',
    category: 'fruit',
    defaultUnit: 'piece',
  },
} as const satisfies Record<string, PantryIngredientShape>

/**
 * Build a `PantryItemData` row — the shape the pantry module renders. Default
 * is a non-staple olive oil. Pass `ingredientId` to pick from the narrow
 * {@link pantryIngredients} catalog, or pass full `ingredient` overrides.
 */
export function createPantryItemData(overrides: Partial<PantryItemData> = {}): PantryItemData {
  const ingredientId = overrides.ingredient?.id ?? 'olive-oil'
  const catalogEntry = (pantryIngredients as Record<string, PantryIngredientShape>)[ingredientId]
  const ingredient: PantryIngredientShape = overrides.ingredient ??
    catalogEntry ?? {
      id: ingredientId,
      name: ingredientId,
      category: 'condiment',
      defaultUnit: 'g',
    }
  return {
    id: `pantry-${ingredient.id}`,
    quantity: null,
    isStaple: false,
    updatedAt: '2026-04-01T12:00:00.000Z',
    ...overrides,
    ingredient,
  }
}

/**
 * Canonical pantry list used by `PantryList` stories — one staple (salt), one
 * staple aromatic (garlic), and two on-hand items (chicken thigh with a known
 * quantity, rice with "have some"). Exercises both rendered sections.
 */
export const defaultPantryItems: PantryItemData[] = [
  createPantryItemData({
    ingredient: pantryIngredients.salt,
    isStaple: true,
  }),
  createPantryItemData({
    ingredient: pantryIngredients.garlic,
    isStaple: true,
  }),
  createPantryItemData({
    ingredient: pantryIngredients['chicken-thigh'],
    quantity: 500,
  }),
  createPantryItemData({
    ingredient: pantryIngredients['short-grain-rice'],
  }),
]

/**
 * Build a `ShoppingItemData` for shopping-list stories. Defaults to an
 * unpurchased 500g chicken breast needed tomorrow. Override any field.
 */
export function createShoppingItem(overrides: Partial<ShoppingItemData> = {}): ShoppingItemData {
  return {
    ingredientId: 'chicken-thigh',
    name: 'Chicken thigh',
    displayQuantity: '500g',
    purchased: false,
    neededByDate: '2026-04-20',
    neededByRelative: 'Monday',
    neededByAbsolute: 'Monday, April 20',
    ...overrides,
  }
}

/**
 * Build a `CustomItemData` for user-added shopping-list entries. Defaults to
 * an unchecked linked "Olive oil" in the fat category.
 */
export function createCustomItem(overrides: Partial<CustomItemData> = {}): CustomItemData {
  return {
    id: 'custom-1',
    name: 'Olive oil',
    checked: false,
    ingredientId: 'olive-oil',
    ingredientCategory: 'fat',
    createdAt: '2026-04-15T10:00:00.000Z',
    ...overrides,
  }
}

/**
 * Canonical protein group — mixed purchased/unpurchased state for progress UI.
 */
export const proteinShoppingItems: ShoppingItemData[] = [
  createShoppingItem({
    ingredientId: 'chicken-thigh',
    name: 'Chicken thigh',
    displayQuantity: '600g',
    neededByRelative: 'tomorrow',
    neededByAbsolute: 'Saturday, April 18',
  }),
  createShoppingItem({
    ingredientId: 'salmon-fillet',
    name: 'Salmon fillet',
    displayQuantity: '300g',
    purchased: true,
    neededByDate: '2026-04-21',
    neededByRelative: 'Tuesday',
    neededByAbsolute: 'Tuesday, April 21',
  }),
  createShoppingItem({
    ingredientId: 'ground-beef',
    name: 'Ground beef',
    displayQuantity: '400g',
    neededByDate: '2026-04-22',
    neededByRelative: 'Wednesday',
    neededByAbsolute: 'Wednesday, April 22',
  }),
]

/**
 * Canonical produce group — single item with vague quantity for italic styling.
 */
export const produceShoppingItems: ShoppingItemData[] = [
  createShoppingItem({
    ingredientId: 'potato',
    name: 'Potato',
    displayQuantity: '1kg',
    neededByRelative: 'tomorrow',
    neededByAbsolute: 'Saturday, April 18',
  }),
  createShoppingItem({
    ingredientId: 'lemon',
    name: 'Lemon',
    displayQuantity: '2 pcs',
    neededByDate: '2026-04-21',
    neededByRelative: 'Tuesday',
    neededByAbsolute: 'Tuesday, April 21',
  }),
  createShoppingItem({
    ingredientId: 'garlic',
    name: 'Garlic',
    displayQuantity: 'some',
    isVague: true,
    neededByRelative: 'tomorrow',
    neededByAbsolute: 'Saturday, April 18',
  }),
]

/**
 * Canonical dairy group — all purchased, shows "all done" UI.
 */
export const dairyShoppingItems: ShoppingItemData[] = [
  createShoppingItem({
    ingredientId: 'butter',
    name: 'Butter',
    displayQuantity: '200g',
    purchased: true,
    neededByRelative: 'tomorrow',
    neededByAbsolute: 'Saturday, April 18',
  }),
  createShoppingItem({
    ingredientId: 'milk',
    name: 'Whole milk',
    displayQuantity: '1L',
    purchased: true,
    neededByDate: '2026-04-22',
    neededByRelative: 'Wednesday',
    neededByAbsolute: 'Wednesday, April 22',
  }),
]

/**
 * Default `ShoppingList` groups — three categories with mixed states.
 * Uses `IngredientCategory` keys so the emoji map in `CategoryGroup` renders.
 */
export const shoppingListGroups: Array<{
  category: IngredientCategory
  categoryLabel: string
  items: ShoppingItemData[]
}> = [
  { category: 'protein', categoryLabel: 'Protein', items: proteinShoppingItems },
  { category: 'vegetable', categoryLabel: 'Vegetable', items: produceShoppingItems },
  { category: 'dairy', categoryLabel: 'Dairy', items: dairyShoppingItems },
]

/**
 * Canonical urgency-bucketed items covering all four `UrgencyBucket` values.
 * Use when exercising `UrgencyGroup` stories.
 */
export const shoppingItemsByUrgency: Record<UrgencyBucket, ShoppingItemData[]> = {
  today: [
    createShoppingItem({
      ingredientId: 'tomato',
      name: 'Tomato',
      displayQuantity: '400g',
      neededByDate: '2026-04-17',
      neededByRelative: 'today',
      neededByAbsolute: 'Friday, April 17',
    }),
    createShoppingItem({
      ingredientId: 'onion',
      name: 'Onion',
      displayQuantity: '2 pcs',
      neededByDate: '2026-04-17',
      neededByRelative: 'today',
      neededByAbsolute: 'Friday, April 17',
      purchased: true,
    }),
  ],
  tomorrow: [
    createShoppingItem({
      ingredientId: 'chicken-thigh',
      name: 'Chicken thigh',
      displayQuantity: '500g',
      neededByDate: '2026-04-18',
      neededByRelative: 'tomorrow',
      neededByAbsolute: 'Saturday, April 18',
    }),
  ],
  'this-week': [
    createShoppingItem({
      ingredientId: 'potato',
      name: 'Potato',
      displayQuantity: '1kg',
      neededByDate: '2026-04-21',
      neededByRelative: 'Tuesday',
      neededByAbsolute: 'Tuesday, April 21',
    }),
    createShoppingItem({
      ingredientId: 'salmon-fillet',
      name: 'Salmon fillet',
      displayQuantity: '300g',
      neededByDate: '2026-04-22',
      neededByRelative: 'Wednesday',
      neededByAbsolute: 'Wednesday, April 22',
    }),
  ],
  later: [
    createShoppingItem({
      ingredientId: 'rice',
      name: 'Short-grain rice',
      displayQuantity: '500g',
      neededByDate: '2026-04-25',
      neededByRelative: 'next week',
      neededByAbsolute: 'Saturday, April 25',
    }),
  ],
}

/**
 * Canonical custom-item list — a mix of linked, unlinked, and checked items.
 */
export const customShoppingItems: CustomItemData[] = [
  createCustomItem({
    id: 'custom-olive-oil',
    name: 'Olive oil',
    ingredientId: 'olive-oil',
    ingredientCategory: 'fat',
  }),
  createCustomItem({
    id: 'custom-paper-towels',
    name: 'Paper towels',
    ingredientId: null,
    ingredientCategory: null,
  }),
  createCustomItem({
    id: 'custom-parmesan',
    name: 'Parmesan',
    ingredientId: 'parmesan',
    ingredientCategory: 'dairy',
    checked: true,
  }),
]

/**
 * Strictly-typed ingredient catalog for `PrefilledIngredient` fixtures. The
 * shared `ingredients` catalog uses `MealComponent['ingredient']` (category
 * is loosely typed as `string`), but `PrefilledIngredient.ingredient` requires
 * a valid `IngredientCategory` enum value, so we keep a narrower lookup here.
 */
const reviewIngredients = {
  'salmon-fillet': {
    id: 'salmon-fillet',
    name: 'Salmon fillet',
    category: 'protein',
    defaultUnit: 'g',
    gramsPerPiece: null,
  },
  'short-grain-rice': {
    id: 'short-grain-rice',
    name: 'Short-grain rice',
    category: 'carb',
    defaultUnit: 'g',
    gramsPerPiece: null,
  },
  'miso-paste': {
    id: 'miso-paste',
    name: 'White miso',
    category: 'condiment',
    defaultUnit: 'g',
    gramsPerPiece: null,
  },
  ginger: {
    id: 'ginger',
    name: 'Fresh ginger',
    category: 'vegetable',
    defaultUnit: 'g',
    gramsPerPiece: null,
  },
  cucumber: {
    id: 'cucumber',
    name: 'Cucumber',
    category: 'vegetable',
    defaultUnit: 'piece',
    gramsPerPiece: 200,
  },
} as const satisfies Record<string, IngredientResult>

type MatchedIngredientOverrides = Partial<
  Pick<PrefilledIngredient, 'ingredient' | 'convertedQuantity' | 'isVague' | 'originalPhrase'>
>

type LowConfidenceIngredientOverrides = Partial<
  Pick<
    PrefilledIngredient,
    | 'ingredient'
    | 'convertedQuantity'
    | 'alternatives'
    | 'extractedName'
    | 'originalText'
    | 'isVague'
    | 'originalPhrase'
  >
>

type UnmatchedIngredientOverrides = Partial<
  Pick<
    PrefilledIngredient,
    | 'extractedName'
    | 'originalText'
    | 'extractedQuantity'
    | 'extractedUnit'
    | 'isVague'
    | 'originalPhrase'
  >
>

/**
 * Build a matched `PrefilledIngredient` (the clean, ready-to-save shape). The
 * default is 600g of salmon fillet — override `ingredient` or `convertedQuantity`
 * to customize.
 */
export function createMatchedPrefilledIngredient(
  overrides: MatchedIngredientOverrides = {},
): PrefilledIngredient {
  return {
    type: 'matched',
    ingredient: reviewIngredients['salmon-fillet'],
    convertedQuantity: 600,
    isVague: false,
    originalPhrase: null,
    ...overrides,
  }
}

/**
 * Build a low-confidence `PrefilledIngredient` — the dialog renders these in
 * the "to verify" bucket with alternatives the user can pick from. Defaults to
 * miso with two alternative brands.
 */
export function createLowConfidencePrefilledIngredient(
  overrides: LowConfidenceIngredientOverrides = {},
): PrefilledIngredient {
  const alternatives: IngredientAlternative[] = [
    {
      id: 'white-miso-marukome',
      name: 'White miso (Marukome)',
      category: 'condiment',
      defaultUnit: 'g',
      similarity: 0.82,
    },
    {
      id: 'white-miso-hikari',
      name: 'White miso (Hikari)',
      category: 'condiment',
      defaultUnit: 'g',
      similarity: 0.78,
    },
  ]
  return {
    type: 'low-confidence',
    extractedName: 'miso',
    originalText: '2 tbsp miso',
    ingredient: reviewIngredients['miso-paste'],
    convertedQuantity: 30,
    alternatives,
    lowConfidence: true,
    isVague: false,
    originalPhrase: null,
    ...overrides,
  }
}

/**
 * Build an unmatched `PrefilledIngredient` — the dialog renders these in the
 * "unmatched" bucket where the user must pick or create an ingredient. Defaults
 * to a pickled-daikon row the AI extractor couldn't confidently resolve.
 */
export function createUnmatchedPrefilledIngredient(
  overrides: UnmatchedIngredientOverrides = {},
): PrefilledIngredient {
  return {
    type: 'unmatched',
    extractedName: 'pickled daikon',
    originalText: '50g pickled daikon',
    extractedQuantity: 50,
    extractedUnit: 'g',
    isVague: false,
    originalPhrase: null,
    ...overrides,
  }
}

/**
 * Build a `ReviewMealData` for `ImagineReviewDialog` stories. Default is a
 * miso-glazed salmon scenario where every ingredient is matched (the clean
 * save path). Pass `prefilledIngredients` to exercise other states.
 */
export function createReviewMealData(overrides: Partial<ReviewMealData> = {}): ReviewMealData {
  return {
    name: 'Miso-glazed salmon with rice',
    description: 'Sweet-savoury broiled salmon with ginger rice and pickled cucumber.',
    preparationNotes: null,
    sourceUrl: null,
    timeMinutes: 30,
    servings: 4,
    mealTypes: [MealType.dinner],
    kidFriendly: true,
    nutrition: { calories: 540, protein: 38, carbs: 55, fat: 18 },
    prefilledIngredients: [
      createMatchedPrefilledIngredient({
        ingredient: reviewIngredients['salmon-fillet'],
        convertedQuantity: 600,
      }),
      createMatchedPrefilledIngredient({
        ingredient: reviewIngredients['short-grain-rice'],
        convertedQuantity: 300,
      }),
      createMatchedPrefilledIngredient({
        ingredient: reviewIngredients['miso-paste'],
        convertedQuantity: 40,
      }),
      createMatchedPrefilledIngredient({
        ingredient: reviewIngredients['ginger'],
        convertedQuantity: 20,
      }),
    ],
    ...overrides,
  }
}

/**
 * Miso-glazed salmon scenario, shaped as `AlternativeMeal` — includes the
 * `reason`, `primaryProteinType`, `description` fields that `AlternativeCard`
 * renders.
 */
export const misoSalmonAlternative: AlternativeMeal = {
  id: 'alt-1',
  name: 'Miso-glazed salmon with rice',
  description: 'Sweet-savoury broiled salmon with ginger rice and pickled cucumber.',
  timeMinutes: 30,
  kidFriendly: true,
  primaryProteinType: 'fish',
  suitableFor: [MealType.dinner],
  reason: 'Balances your week’s protein mix — you’ve had poultry three times already.',
  components: [
    createMealComponent({ ingredientId: 'salmon-fillet', quantityPerServing: 150 }),
    createMealComponent({ ingredientId: 'short-grain-rice', quantityPerServing: 75 }),
    createMealComponent({ ingredientId: 'miso-paste', quantityPerServing: 10 }),
  ],
  nutrition: { calories: 540, protein: 38, carbs: 55, fat: 18 },
}

/**
 * Catalog of strictly-typed `IngredientResult` shapes used by household
 * `IngredientSearch` and `MealForm` stories. Keyed by id so factories can look
 * up entries the same way the meal-plan ingredient catalog above does.
 */
export const ingredientResults = {
  'chicken-thigh': {
    id: 'chicken-thigh',
    name: 'Chicken thigh',
    category: 'protein',
    defaultUnit: 'g',
    gramsPerPiece: null,
    calories: 209,
    protein: 26,
    carbs: 0,
    fat: 11,
  },
  potato: {
    id: 'potato',
    name: 'Potato',
    category: 'vegetable',
    defaultUnit: 'g',
    gramsPerPiece: null,
    calories: 77,
    protein: 2,
    carbs: 17,
    fat: 0.1,
  },
  lemon: {
    id: 'lemon',
    name: 'Lemon',
    category: 'fruit',
    defaultUnit: 'piece',
    gramsPerPiece: 60,
    calories: 17,
    protein: 0.6,
    carbs: 5.4,
    fat: 0.2,
  },
  garlic: {
    id: 'garlic',
    name: 'Garlic',
    category: 'vegetable',
    defaultUnit: 'piece',
    gramsPerPiece: 5,
    calories: 149,
    protein: 6.4,
    carbs: 33,
    fat: 0.5,
  },
  'olive-oil': {
    id: 'olive-oil',
    name: 'Olive oil',
    category: 'fat',
    defaultUnit: 'g',
    gramsPerPiece: null,
    calories: 884,
    protein: 0,
    carbs: 0,
    fat: 100,
  },
  'salmon-fillet': {
    id: 'salmon-fillet',
    name: 'Salmon fillet',
    category: 'protein',
    defaultUnit: 'g',
    gramsPerPiece: null,
    calories: 208,
    protein: 20,
    carbs: 0,
    fat: 13,
  },
} as const satisfies Record<string, IngredientResult>

/**
 * Build an `IngredientResult` for `IngredientSearch` and `MealForm` stories.
 * Defaults to chicken thigh — pass `id` matching a key in {@link ingredientResults}
 * to swap to a catalog entry, or pass full overrides for a one-off shape.
 */
export function createIngredientResult(
  overrides: Partial<IngredientResult> = {},
): IngredientResult {
  const id = overrides.id ?? 'chicken-thigh'
  const catalogEntry = (ingredientResults as Record<string, IngredientResult>)[id]
  if (catalogEntry) {
    return { ...catalogEntry, ...overrides }
  }
  return { ...ingredientResults['chicken-thigh'], ...overrides, id }
}

/**
 * Build a `MealComponent` for the household `MealForm`. Default = 600g of
 * chicken thigh (matches a 4-serving recipe at 150g per serving). Pass `id`
 * via `ingredient.id` to swap the ingredient sub-object.
 */
export function createMealFormComponent(
  overrides: Partial<MealFormComponent> = {},
): MealFormComponent {
  const ingredient = overrides.ingredient ?? createIngredientResult()
  return {
    ingredientId: ingredient.id,
    ingredient,
    totalQuantity: 600,
    isVague: false,
    originalPhrase: null,
    ...overrides,
  }
}

/**
 * Default `MemberPreferences` shape — a regular adult with no dietary
 * restrictions. Override any field to build other personas (child, vegan,
 * allergens).
 */
export function createMemberPreferences(
  overrides: Partial<MemberPreferences> = {},
): MemberPreferences {
  return {
    displayName: null,
    portionMultiplier: 1.0,
    targetCalories: null,
    targetProtein: null,
    targetCarbs: null,
    targetFat: null,
    dietaryType: null,
    allergens: [],
    restrictions: [],
    excludedIngredients: [],
    excludedIngredientIds: [],
    ...overrides,
  }
}

/**
 * Build an active `MemberInvite` link expiring one week from a fixed date so
 * stories render the same human-readable expiry every snapshot.
 */
export function createMemberInvite(overrides: Partial<MemberInvite> = {}): MemberInvite {
  return {
    url: 'https://honkadori.xyz/invite/abc123',
    expiresAt: '2026-04-24T12:00:00.000Z',
    isActive: true,
    ...overrides,
  }
}

/**
 * Build a `Member`. Default = household owner "Alex Doe" with regular portion
 * size. Pass `role: 'member'` for non-owners and override `preferences` /
 * `user` / `invite` to build the variants stories need.
 */
export function createMember(overrides: Partial<Member> = {}): Member {
  const preferences = overrides.preferences ?? createMemberPreferences()
  return {
    id: 'member-owner',
    userId: 'user-1',
    name: 'Alex Doe',
    role: 'owner',
    joinedAt: '2026-01-15T12:00:00.000Z',
    user: {
      id: 'user-1',
      name: 'Alex Doe',
      email: 'alex@example.com',
      image: null,
    },
    preferences,
    invite: null,
    ...overrides,
  }
}

/**
 * Build a child member — small portion, manual (no linked user account), no
 * invite yet. Defaults to "Sam" so stories read naturally next to the owner.
 */
export function createChildMember(overrides: Partial<Member> = {}): Member {
  return createMember({
    id: 'member-child',
    userId: null,
    name: 'Sam',
    role: 'member',
    user: null,
    preferences: createMemberPreferences({
      displayName: 'kiddo',
      portionMultiplier: 0.75,
    }),
    invite: null,
    ...overrides,
  })
}

/**
 * Build a manual (no linked user) member with a pending invite link — used by
 * `MemberCard` and `MemberInviteDialog` stories.
 */
export function createManualMemberWithInvite(overrides: Partial<Member> = {}): Member {
  return createMember({
    id: 'member-pending',
    userId: null,
    name: 'Jordan',
    role: 'member',
    user: null,
    preferences: createMemberPreferences({ portionMultiplier: 1.5 }),
    invite: createMemberInvite(),
    ...overrides,
  })
}

type HouseholdMealComponent = HouseholdMealData['components'][number]

/**
 * Build a strictly-typed `MealData['components']` entry for the household
 * `MealList`. Picks the ingredient sub-object from {@link ingredientResults},
 * which uses the strict `IngredientCategory` enum (the meal-plan
 * `createMealComponent` returns a loose-string category that doesn't satisfy
 * the household shape).
 */
function createHouseholdMealComponent(
  ingredientId: keyof typeof ingredientResults,
  quantityPerServing: number,
): HouseholdMealComponent {
  const ingredient = ingredientResults[ingredientId]
  return {
    ingredientId: ingredient.id,
    quantityPerServing,
    ingredient: {
      id: ingredient.id,
      name: ingredient.name,
      category: ingredient.category,
      defaultUnit: ingredient.defaultUnit,
      gramsPerPiece: ingredient.gramsPerPiece,
    },
  }
}

const householdLemonGarlicComponents: HouseholdMealComponent[] = [
  createHouseholdMealComponent('chicken-thigh', 150),
  createHouseholdMealComponent('potato', 200),
  createHouseholdMealComponent('lemon', 0.5),
  createHouseholdMealComponent('garlic', 2),
]

/**
 * Build a `MealData` row for the household `MealList`. Default = lemon-garlic
 * roast chicken with full meal-card metadata. Pass overrides for empty/edge
 * states or alternate meals.
 */
export function createHouseholdMealListData(
  overrides: Partial<HouseholdMealData> = {},
): HouseholdMealData {
  return {
    id: 'household-meal-1',
    name: 'Lemon-garlic roast chicken',
    description: 'Weeknight-friendly sheet-pan dinner with crisp skin and bright citrus.',
    preparationNotes: null,
    sourceUrl: null,
    timeMinutes: 45,
    kidFriendly: true,
    primaryProteinType: 'poultry',
    suitableFor: [MealType.dinner],
    servings: 4,
    isCustom: true,
    isFavorite: false,
    createdAt: '2026-04-01T12:00:00.000Z',
    updatedAt: '2026-04-01T12:00:00.000Z',
    components: householdLemonGarlicComponents,
    nutrition: { calories: 520, protein: 42, carbs: 30, fat: 28 },
    allergens: [],
    ...overrides,
  }
}

/**
 * Three-meal sample list used by `MealList` stories — a poultry meal, a fish
 * meal, and a vegetarian one — so the rendered list shows variety in protein
 * type and time.
 */
export const householdMealList: HouseholdMealData[] = [
  createHouseholdMealListData(),
  createHouseholdMealListData({
    id: 'household-meal-2',
    name: 'Miso-glazed salmon with rice',
    description: 'Sweet-savoury broiled salmon with ginger rice and pickled cucumber.',
    primaryProteinType: 'fish',
    timeMinutes: 30,
    isFavorite: true,
    components: [createHouseholdMealComponent('salmon-fillet', 150)],
    nutrition: { calories: 540, protein: 38, carbs: 55, fat: 18 },
  }),
  createHouseholdMealListData({
    id: 'household-meal-3',
    name: 'Spiced red-lentil stew',
    description: 'One-pot weeknight stew with warming spices and coconut milk.',
    primaryProteinType: 'none',
    timeMinutes: 35,
    components: [createHouseholdMealComponent('potato', 180)],
    nutrition: { calories: 410, protein: 18, carbs: 62, fat: 12 },
  }),
]

/**
 * Canonical "today" used by timeline stories. Pinned so axe snapshots and
 * relative-date rendering stay deterministic across story runs. 2026-04-15 is
 * a Wednesday, giving us a representative weekday for the default timeline.
 */
export const timelineTodayDate = '2026-04-15'

/**
 * Build a `PlanEntry`. Default = a `planned` dinner entry backed by the
 * canonical lemon-garlic chicken meal. Dates default to the pinned
 * {@link timelineTodayDate}. Override any field to model other statuses,
 * meal types, or an empty (meal = null) slot.
 */
export function createPlanEntry(overrides: Partial<PlanEntry> = {}): PlanEntry {
  return {
    id: 'entry-1',
    date: timelineTodayDate,
    mealType: MealType.dinner,
    status: 'planned',
    rating: null,
    meal: createMeal(),
    preparationTips: null,
    note: null,
    servingOverride: null,
    ...overrides,
  }
}

/**
 * Build an {@link ExpectedMealTypes}. Default = dinner-only weekday+weekend,
 * matching the app's default meal-type configuration.
 */
export function createExpectedMealTypes(
  overrides: Partial<ExpectedMealTypes> = {},
): ExpectedMealTypes {
  return {
    weekdayMealTypes: [MealType.dinner],
    weekendMealTypes: [MealType.dinner],
    ...overrides,
  }
}

/**
 * Build a {@link TimelineDay}. Default = "Today" (Wed 2026-04-15) with one
 * planned dinner entry and no empty slots. Override flags and entries/slots
 * arrays to model any calendar position.
 */
export function createTimelineDay(overrides: Partial<TimelineDay> = {}): TimelineDay {
  return {
    date: timelineTodayDate,
    label: 'Today',
    isToday: true,
    isTomorrow: false,
    isPast: false,
    entries: [createPlanEntry()],
    emptySlots: [],
    ...overrides,
  }
}

/**
 * Shape of an item rendered by `UrgentShopping`. Kept local since the consuming
 * component defines its `ShoppingItem` inline and we don't want to import the
 * private alias.
 */
export interface UrgentShoppingItemData {
  ingredientId: string
  name: string
  displayQuantity: string
  neededByDate: string
  neededByRelative: string
  purchased: boolean
  urgency: UrgencyBucket
}

/**
 * Build an `UrgentShopping` row. Default = 500g of chicken thigh needed today,
 * unpurchased. Override `urgency`, `purchased`, etc. to model sidebar states.
 */
export function createUrgentShoppingItem(
  overrides: Partial<UrgentShoppingItemData> = {},
): UrgentShoppingItemData {
  return {
    ingredientId: 'chicken-thigh',
    name: 'Chicken thigh',
    displayQuantity: '500g',
    neededByDate: timelineTodayDate,
    neededByRelative: 'today',
    purchased: false,
    urgency: 'today',
    ...overrides,
  }
}

/**
 * Canonical "mixed urgency" sidebar — two today items (one purchased), one
 * tomorrow item, one this-week (should be filtered out by the component). Use
 * to render the default populated `UrgentShopping` state.
 */
export const urgentShoppingItems: UrgentShoppingItemData[] = [
  createUrgentShoppingItem({
    ingredientId: 'chicken-thigh',
    name: 'Chicken thigh',
    displayQuantity: '600g',
  }),
  createUrgentShoppingItem({
    ingredientId: 'onion',
    name: 'Onion',
    displayQuantity: '2 pcs',
    purchased: true,
  }),
  createUrgentShoppingItem({
    ingredientId: 'salmon-fillet',
    name: 'Salmon fillet',
    displayQuantity: '300g',
    neededByDate: '2026-04-16',
    neededByRelative: 'tomorrow',
    urgency: 'tomorrow',
  }),
  createUrgentShoppingItem({
    ingredientId: 'potato',
    name: 'Potato',
    displayQuantity: '1kg',
    neededByDate: '2026-04-19',
    neededByRelative: 'Sunday',
    urgency: 'this-week',
  }),
]

/**
 * Build an `IngredientAlternative` — the shape the "verify match" Select in
 * `LowConfidenceIngredientRow` renders. Defaults to an alternate short-grain
 * rice with 0.8 similarity. Pass `id` / `name` / `category` for one-off rows.
 */
export function createIngredientAlternative(
  overrides: Partial<IngredientAlternative> = {},
): IngredientAlternative {
  return {
    id: 'short-grain-rice-alt',
    name: 'Medium-grain rice',
    category: 'carb',
    defaultUnit: 'g',
    similarity: 0.8,
    ...overrides,
  }
}

/**
 * Build a `MatchedIngredientData` for the `IngredientRow` dispatcher. Default =
 * 600g of chicken thigh, matched (high-confidence). Pass `ingredient` to swap
 * to another catalog entry from {@link ingredientResults}, or override any
 * other field for vague / invalid variants.
 */
export function createMatchedIngredientRowData(
  overrides: Partial<Omit<MatchedIngredientData, 'type'>> = {},
): MatchedIngredientData {
  return {
    type: 'matched',
    ingredient: ingredientResults['chicken-thigh'],
    totalQuantity: 600,
    isVague: false,
    originalPhrase: null,
    ...overrides,
  }
}

/**
 * Build a `LowConfidenceIngredientData` for the `IngredientRow` dispatcher and
 * `LowConfidenceIngredientRow`. Default = "chicken thighs" extracted with the
 * canonical chicken-thigh ingredient as the best match, plus one alternative.
 */
export function createLowConfidenceIngredientRowData(
  overrides: Partial<Omit<LowConfidenceIngredientData, 'type'>> = {},
): LowConfidenceIngredientData {
  return {
    type: 'low-confidence',
    extractedName: 'chicken thighs',
    originalText: '600g chicken thighs',
    ingredient: ingredientResults['chicken-thigh'],
    alternatives: [
      createIngredientAlternative({
        id: 'chicken-breast',
        name: 'Chicken breast',
        category: 'protein',
        defaultUnit: 'g',
        similarity: 0.82,
      }),
      createIngredientAlternative({
        id: 'chicken-drumstick',
        name: 'Chicken drumstick',
        category: 'protein',
        defaultUnit: 'piece',
        similarity: 0.78,
      }),
    ],
    totalQuantity: 600,
    isVague: false,
    originalPhrase: null,
    ...overrides,
  }
}

/**
 * Build an `UnmatchedIngredientData` for the `IngredientRow` dispatcher and
 * `UnmatchedIngredientRow`. Default = 50g of "pickled daikon" the extractor
 * could not resolve.
 */
export function createUnmatchedIngredientRowData(
  overrides: Partial<Omit<UnmatchedIngredientData, 'type'>> = {},
): UnmatchedIngredientData {
  return {
    type: 'unmatched',
    extractedName: 'pickled daikon',
    originalText: '50g pickled daikon',
    extractedQuantity: 50,
    extractedUnit: 'g',
    isVague: false,
    originalPhrase: null,
    ...overrides,
  }
}
