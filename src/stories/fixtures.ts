import { MealType } from '@/generated/prisma/enums'
import type { MealCardBaseData } from '@/components/meal-plan/MealCardBase'
import type {
  AlternativeMeal,
  MealComponent,
  MealData,
  PantryIngredient,
  PantryItemFull,
} from '@/components/meal-plan/types'

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
