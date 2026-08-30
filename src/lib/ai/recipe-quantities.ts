import type { IngredientCategory, Unit } from '@/generated/prisma/enums'

/**
 * Maximum reasonable quantity per serving for any ingredient (in grams).
 * Anything above this is likely a parsing error.
 */
export const MAX_GRAMS_PER_SERVING = 500

/**
 * Default grams per piece when not specified in the database.
 * Using 30g as a reasonable middle-ground (e.g., small tomato, egg, etc.)
 * Much better than 100g which caused absurd quantities for small items like garlic.
 */
export const DEFAULT_GRAMS_PER_PIECE = 30

/**
 * Category-specific cup-to-gram conversions.
 * Different ingredient types have vastly different densities.
 */
export const CUP_CONVERSIONS: Record<IngredientCategory | 'default', number> = {
  spice: 30, // Herbs and spices are very light (1 cup basil ≈ 20-30g)
  dairy: 240, // Liquids like milk (1 cup ≈ 240g)
  carb: 180, // Rice, oats, pasta, etc. (1 cup ≈ 150-200g)
  protein: 150, // Shredded/diced meat (1 cup ≈ 140-160g)
  vegetable: 150, // Diced vegetables (1 cup ≈ 130-170g)
  fruit: 150, // Diced fruit (1 cup ≈ 140-170g)
  fat: 220, // Oils, butter (1 cup ≈ 220g)
  legume: 180, // Beans, lentils (1 cup ≈ 170-190g)
  condiment: 240, // Sauces, liquids (1 cup ≈ 240g)
  default: 150, // Fallback for unknown categories
}

/**
 * Convert an extracted quantity and unit to the ingredient's default unit.
 */
export function convertQuantity(
  quantity: number,
  fromUnit: string,
  ingredient: { defaultUnit: Unit; gramsPerPiece: number | null; category?: IngredientCategory },
): number {
  const { defaultUnit, gramsPerPiece, category } = ingredient

  // Already in the right unit
  if (fromUnit === defaultUnit) {
    return quantity
  }

  // Convert to grams first (if needed)
  let grams: number

  switch (fromUnit) {
    case 'g':
      grams = quantity
      break
    case 'ml':
      // Approximate: assume density ~1 for most liquids
      grams = quantity
      break
    case 'piece':
      // Use gramsPerPiece if available, otherwise use a reasonable default
      grams = gramsPerPiece ? quantity * gramsPerPiece : quantity * DEFAULT_GRAMS_PER_PIECE
      break
    case 'tbsp':
      grams = quantity * 15
      break
    case 'tsp':
      grams = quantity * 5
      break
    case 'cup':
      // Use category-specific cup conversion for accuracy
      grams = quantity * (category ? CUP_CONVERSIONS[category] : CUP_CONVERSIONS.default)
      break
    case 'oz':
      grams = quantity * 28
      break
    case 'lb':
      grams = quantity * 454
      break
    default:
      grams = quantity
  }

  // Convert from grams to target unit
  if (defaultUnit === 'g') {
    return grams
  }

  if (defaultUnit === 'piece') {
    // Convert grams back to pieces
    if (gramsPerPiece && gramsPerPiece > 0) {
      return Math.round((grams / gramsPerPiece) * 10) / 10
    }
    // Can't convert, use original quantity as pieces
    return quantity
  }

  // Shouldn't happen, but fallback
  return grams
}

/**
 * Validate that a quantity is reasonable for a recipe.
 * Returns true if the quantity seems reasonable, false if it's suspiciously high.
 */
export function isReasonableQuantity(totalGrams: number, servings: number): boolean {
  const gramsPerServing = totalGrams / servings
  return gramsPerServing <= MAX_GRAMS_PER_SERVING
}
