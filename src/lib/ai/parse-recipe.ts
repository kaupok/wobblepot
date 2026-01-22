import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import type { IngredientCategory, MealType, Unit } from '@/generated/prisma/enums'

/**
 * Schema for a single extracted ingredient from recipe text.
 */
const ExtractedIngredientSchema = z.object({
  name: z.string().describe('The ingredient name without quantity (e.g., "chicken breast")'),
  quantity: z.number().positive().describe('The numeric quantity'),
  unit: z
    .enum(['g', 'piece', 'ml', 'tbsp', 'tsp', 'cup', 'oz', 'lb'])
    .describe('The unit of measurement'),
  originalText: z
    .string()
    .describe('The original text from the recipe (e.g., "2 chicken breasts")'),
})

/**
 * Schema for AI structured output of recipe extraction.
 */
export const RecipeExtractionSchema = z.object({
  name: z.string().min(1).max(200).describe('The recipe name'),
  description: z
    .string()
    .max(1000)
    .nullable()
    .describe('A brief description of the dish, or null if not found'),
  timeMinutes: z
    .number()
    .int()
    .positive()
    .max(480)
    .nullable()
    .describe('Total prep + cook time in minutes, or null if not specified'),
  servings: z
    .number()
    .int()
    .positive()
    .max(50)
    .describe('Number of servings the recipe makes, default to 4 if not specified'),
  mealTypes: z
    .array(z.enum(['breakfast', 'lunch', 'dinner']))
    .min(1)
    .describe('Which meal types this recipe is suitable for'),
  kidFriendly: z
    .boolean()
    .describe('Whether this recipe is likely kid-friendly (no spicy ingredients, simple flavors)'),
  ingredients: z
    .array(ExtractedIngredientSchema)
    .min(1)
    .describe('The list of ingredients with quantities'),
})

export type RecipeExtraction = z.infer<typeof RecipeExtractionSchema>
export type ExtractedIngredient = z.infer<typeof ExtractedIngredientSchema>

/**
 * Error thrown when recipe parsing fails due to insufficient content.
 */
export class RecipeParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecipeParseError'
  }
}

/**
 * Build the prompt for recipe extraction.
 */
function buildRecipeExtractionPrompt(recipeText: string): string {
  return `You are a recipe parsing assistant. Extract structured data from the following recipe text.

IMPORTANT GUIDELINES:
1. Extract the recipe name, description, cooking time, servings, and ingredients
2. For ingredients, extract the quantity, unit, and ingredient name separately
3. Use these units: "g" for weight, "ml" for volume, "piece" for countable items, or keep original units ("cup", "tbsp", "tsp", "oz", "lb") if conversion would be inaccurate

CRITICAL QUANTITY RULES:
- For countable items (eggs, garlic cloves, chicken breasts, onions), use "piece" as unit with the COUNT as quantity
  Example: "4 cloves garlic" → quantity: 4, unit: "piece", name: "garlic"
  Example: "2 chicken breasts" → quantity: 2, unit: "piece", name: "chicken breast"
- For herbs/leaves measured in cups, convert to grams (1 cup fresh herbs ≈ 20-30g)
  Example: "2 cups basil leaves" → quantity: 50, unit: "g", name: "basil"
- For liquids in cups, keep as cups OR convert (1 cup liquid = 240ml)
- For weight measurements, always use grams: 1 oz = 28g, 1 lb = 454g
- For small measurements: 1 tbsp = 15g, 1 tsp = 5g

SANITY CHECKS - Typical per-serving quantities:
- Herbs/spices: 5-20g per serving
- Garlic: 1-3 cloves (5-15g) per serving
- Main protein: 100-200g per serving
- Vegetables: 50-150g per serving
- Grains/pasta: 75-125g (dry) per serving
If your calculated quantities exceed these by 5x+, you likely made a conversion error.

4. Determine meal types based on the recipe content (breakfast items like eggs/pancakes, lunch/dinner for mains)
5. Mark as kid-friendly if: no spicy ingredients, familiar foods, mild flavors
6. If servings aren't specified, default to 4
7. If cooking time isn't specified, leave it as null

RECIPE TEXT:
${recipeText}

Extract the structured recipe data. If the text doesn't contain enough information to extract a recipe (no clear ingredients or recipe name), return an error message explaining what's missing.`
}

/**
 * Parse recipe text using AI to extract structured data.
 * Throws RecipeParseError if the text doesn't contain enough information.
 */
export async function parseRecipeText(recipeText: string): Promise<RecipeExtraction> {
  const trimmedText = recipeText.trim()

  // Minimum sanity check
  if (trimmedText.length < 20) {
    throw new RecipeParseError(
      'The text is too short to be a recipe. Please paste a complete recipe with ingredients.',
    )
  }

  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })
  const prompt = buildRecipeExtractionPrompt(trimmedText)

  try {
    const { object } = await generateObject({
      model: anthropic('claude-sonnet-4-20250514'),
      schema: RecipeExtractionSchema,
      prompt,
    })

    // Validate we got meaningful data
    if (!object.name || object.ingredients.length === 0) {
      throw new RecipeParseError(
        "Couldn't extract a recipe from this text. Please make sure it includes a recipe name and list of ingredients.",
      )
    }

    // Check for placeholder/invalid ingredient names
    const invalidIngredients = object.ingredients.filter((ing) => {
      const name = ing.name.toLowerCase().trim()
      return (
        name.includes('<unknown>') ||
        name.includes('unknown') ||
        name === '' ||
        name === 'ingredient' ||
        name === 'item'
      )
    })

    if (invalidIngredients.length > 0 || object.ingredients.length === invalidIngredients.length) {
      throw new RecipeParseError(
        "Couldn't identify specific ingredients from this text. Please paste a recipe with a clear list of ingredients.",
      )
    }

    return object
  } catch (error) {
    if (error instanceof RecipeParseError) {
      throw error
    }
    // AI generation error
    throw new RecipeParseError(
      'Failed to parse the recipe. Please try again or use the manual form.',
    )
  }
}

/**
 * Result of matching an ingredient against the database.
 */
export interface MatchedIngredient {
  type: 'matched'
  extractedName: string
  extractedQuantity: number
  extractedUnit: string
  originalText: string
  ingredient: {
    id: string
    name: string
    category: IngredientCategory
    defaultUnit: Unit
    gramsPerPiece: number | null
  }
  /** Quantity converted to the ingredient's default unit */
  convertedQuantity: number
  /** Warning if quantity seems unusually high */
  quantityWarning?: string
}

export interface UnmatchedIngredient {
  type: 'unmatched'
  extractedName: string
  extractedQuantity: number
  extractedUnit: string
  originalText: string
}

export type IngredientMatchResult = MatchedIngredient | UnmatchedIngredient

/**
 * Result of the full recipe parsing and matching process.
 */
export interface ParsedRecipe {
  name: string
  description: string | null
  timeMinutes: number | null
  servings: number
  mealTypes: MealType[]
  kidFriendly: boolean
  ingredients: IngredientMatchResult[]
  allMatched: boolean
}

/**
 * Minimum similarity score for fuzzy ingredient matching.
 * Raised from 0.3 to 0.45 to prevent false positives like "baking powder" → "curry powder".
 */
const SIMILARITY_THRESHOLD = 0.45

/**
 * Maximum reasonable quantity per serving for any ingredient (in grams).
 * Anything above this is likely a parsing error.
 */
const MAX_GRAMS_PER_SERVING = 500

/**
 * Default grams per piece when not specified in the database.
 * Using 30g as a reasonable middle-ground (e.g., small tomato, egg, etc.)
 * Much better than 100g which caused absurd quantities for small items like garlic.
 */
const DEFAULT_GRAMS_PER_PIECE = 30

/**
 * Category-specific cup-to-gram conversions.
 * Different ingredient types have vastly different densities.
 */
const CUP_CONVERSIONS: Record<IngredientCategory | 'default', number> = {
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
function convertQuantity(
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
function isReasonableQuantity(totalGrams: number, servings: number): boolean {
  const gramsPerServing = totalGrams / servings
  return gramsPerServing <= MAX_GRAMS_PER_SERVING
}

/**
 * Match extracted ingredients against the database using fuzzy search.
 * @param extractedIngredients - The ingredients extracted by AI
 * @param servings - Number of servings for quantity validation
 */
export async function matchIngredients(
  extractedIngredients: ExtractedIngredient[],
  servings: number,
): Promise<IngredientMatchResult[]> {
  const results: IngredientMatchResult[] = []

  for (const extracted of extractedIngredients) {
    // Normalize the name for searching
    const searchName = extracted.name.toLowerCase().trim()

    // Use pg_trgm similarity search
    const matches = await prisma.$queryRaw<
      Array<{
        id: string
        name: string
        category: IngredientCategory
        defaultUnit: Unit
        gramsPerPiece: number | null
        similarity: number
      }>
    >`
      SELECT
        id,
        name,
        category,
        "defaultUnit",
        "gramsPerPiece",
        similarity(name, ${searchName}) as similarity
      FROM "ingredient"
      WHERE similarity(name, ${searchName}) >= ${SIMILARITY_THRESHOLD}
      ORDER BY similarity DESC
      LIMIT 1
    `

    if (matches.length > 0 && matches[0]) {
      const match = matches[0]
      const convertedQuantity = convertQuantity(extracted.quantity, extracted.unit, match)

      // Calculate total grams for validation (estimate if not in grams)
      let totalGrams = convertedQuantity
      if (match.defaultUnit === 'piece' && match.gramsPerPiece) {
        totalGrams = convertedQuantity * match.gramsPerPiece
      }

      // Check if quantity seems unreasonable
      let quantityWarning: string | undefined
      if (!isReasonableQuantity(totalGrams, servings)) {
        const gramsPerServing = Math.round(totalGrams / servings)
        quantityWarning = `Unusually high: ${gramsPerServing}g per serving. Please verify this amount.`
      }

      results.push({
        type: 'matched',
        extractedName: extracted.name,
        extractedQuantity: extracted.quantity,
        extractedUnit: extracted.unit,
        originalText: extracted.originalText,
        ingredient: {
          id: match.id,
          name: match.name,
          category: match.category,
          defaultUnit: match.defaultUnit,
          gramsPerPiece: match.gramsPerPiece,
        },
        convertedQuantity,
        quantityWarning,
      })
    } else {
      results.push({
        type: 'unmatched',
        extractedName: extracted.name,
        extractedQuantity: extracted.quantity,
        extractedUnit: extracted.unit,
        originalText: extracted.originalText,
      })
    }
  }

  return results
}

/**
 * Parse recipe text and match ingredients against the database.
 * This is the main entry point for the recipe import feature.
 */
export async function parseAndMatchRecipe(recipeText: string): Promise<ParsedRecipe> {
  // Step 1: Extract structured data from text
  const extraction = await parseRecipeText(recipeText)

  // Step 2: Match ingredients against database (pass servings for validation)
  const ingredientResults = await matchIngredients(extraction.ingredients, extraction.servings)

  // Step 3: Check if all ingredients matched
  const allMatched = ingredientResults.every((r) => r.type === 'matched')

  return {
    name: extraction.name,
    description: extraction.description,
    timeMinutes: extraction.timeMinutes,
    servings: extraction.servings,
    mealTypes: extraction.mealTypes as MealType[],
    kidFriendly: extraction.kidFriendly,
    ingredients: ingredientResults,
    allMatched,
  }
}
