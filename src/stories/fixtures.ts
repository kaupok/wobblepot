import { MealType, type IngredientCategory } from '@/generated/prisma/enums'
import type { MealCardBaseData } from '@/components/meal-plan/MealCardBase'
import type {
  AlternativeMeal,
  MealComponent,
  MealData,
  PantryIngredient,
  PantryItemFull,
} from '@/components/meal-plan/types'
import type { CustomItemData } from '@/components/shopping/CustomItemInput'
import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'
import type { UrgencyBucket } from '@/lib/meal-planning/dates'

type IngredientShape = MealComponent['ingredient']
type PantryItemIngredient = PantryItemFull['ingredient']

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
