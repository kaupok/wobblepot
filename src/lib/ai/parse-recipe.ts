import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { RECIPE_MODEL } from './models'
import type { AiUsageStats } from './usage'
import type { IngredientCategory, MealType, Unit } from '@/generated/prisma/enums'
import {
  VAGUE_PHRASES,
  getVagueDefault,
  checkGuardrail,
  type VagueQuantityResult,
} from '@/lib/vague-quantities'
import { applyIngredientAlias } from '@/lib/ingredient-aliases'
import { normalizeIngredientName, extractLastWord } from '@/lib/normalize-ingredient'
import { HONKADORI_BOT_USER_AGENT, checkRobotsAllowed } from '@/lib/robots'
import { DEFAULT_LOCALE } from '@/lib/i18n/locales'

/**
 * Error message emitted when robots.txt disallows the fetch. Used as a sentinel
 * by `/api/recipes/parse` to return 403 specifically for this case.
 */
export const ROBOTS_DISALLOWED_MESSAGE =
  "This site doesn't allow automated content extraction. Try pasting the recipe text directly instead."

/**
 * Maximum characters of stripped HTML to send to AI parser.
 * Prevents token overflow on ad-heavy sites without JSON-LD.
 */
const MAX_STRIPPED_TEXT_LENGTH = 10_000

/**
 * Extract JSON-LD Recipe data from HTML and format as clean text.
 * Looks for `<script type="application/ld+json">` blocks containing `@type: Recipe`.
 * Returns formatted recipe text, or null if no Recipe found.
 */
export function extractJsonLdRecipe(html: string): string | null {
  const scriptRegex =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  const matches: string[] = []
  let match: RegExpExecArray | null

  while ((match = scriptRegex.exec(html)) !== null) {
    if (match[1]) {
      matches.push(match[1])
    }
  }

  if (matches.length === 0) return null

  for (const jsonText of matches) {
    try {
      const data = JSON.parse(jsonText)
      const recipe = findRecipeInJsonLd(data)
      if (recipe) {
        return formatJsonLdRecipe(recipe)
      }
    } catch {
      // Invalid JSON, try next block
    }
  }

  return null
}

/**
 * Recursively search for a Recipe object in JSON-LD data.
 * Handles top-level objects, @graph arrays, and arrays of objects.
 */
function findRecipeInJsonLd(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null

  if (Array.isArray(data)) {
    for (const item of data) {
      const result = findRecipeInJsonLd(item)
      if (result) return result
    }
    return null
  }

  const obj = data as Record<string, unknown>

  // Check if this object is a Recipe
  if (obj['@type'] === 'Recipe') return obj

  // Handle @type as array (e.g., ["Recipe", "HowTo"])
  if (Array.isArray(obj['@type']) && (obj['@type'] as string[]).includes('Recipe')) return obj

  // Check @graph array
  if (Array.isArray(obj['@graph'])) {
    return findRecipeInJsonLd(obj['@graph'])
  }

  return null
}

/**
 * Format a JSON-LD Recipe object as clean text for the AI parser.
 * Returns null if the formatted text is too short to be useful.
 */
function formatJsonLdRecipe(recipe: Record<string, unknown>): string | null {
  const parts: string[] = []

  // Recipe name
  const name = recipe.name
  if (typeof name === 'string') {
    parts.push(`Recipe: ${name}`)
  }

  // Description
  const description = recipe.description
  if (typeof description === 'string') {
    parts.push(`\nDescription: ${description}`)
  }

  // Prep/cook time
  const prepTime = parseDuration(recipe.prepTime)
  const cookTime = parseDuration(recipe.cookTime)
  const totalTime = parseDuration(recipe.totalTime)
  const timeStr = [
    prepTime ? `Prep: ${prepTime} min` : null,
    cookTime ? `Cook: ${cookTime} min` : null,
    totalTime ? `Total: ${totalTime} min` : null,
  ]
    .filter(Boolean)
    .join(', ')
  if (timeStr) {
    parts.push(`\nTime: ${timeStr}`)
  }

  // Servings
  const servings = recipe.recipeYield
  if (servings) {
    const yieldStr = Array.isArray(servings) ? servings[0] : servings
    parts.push(`\nServings: ${yieldStr}`)
  }

  // Ingredients
  const ingredients = recipe.recipeIngredient
  if (Array.isArray(ingredients) && ingredients.length > 0) {
    parts.push('\n\nIngredients:')
    for (const ing of ingredients) {
      if (typeof ing === 'string') {
        parts.push(`- ${ing}`)
      }
    }
  }

  // Instructions — handles HowToStep, HowToSection, strings, and mixed arrays
  const instructions = recipe.recipeInstructions
  if (instructions) {
    const steps = extractInstructionSteps(instructions)
    if (steps.length > 0) {
      parts.push('\n\nInstructions:')
      for (let i = 0; i < steps.length; i++) {
        parts.push(`${i + 1}. ${steps[i]}`)
      }
    }
  }

  const formatted = parts.join('\n')
  return formatted.length >= 50 ? formatted : null
}

/**
 * Extract instruction step texts from JSON-LD recipeInstructions.
 * Handles all common formats:
 * - String: single instruction
 * - String[]: array of instruction strings
 * - HowToStep[]: array of objects with `text` property
 * - HowToSection[]: array of sections with `itemListElement` arrays of HowToStep
 * - Mixed arrays of the above
 */
function extractInstructionSteps(instructions: unknown): string[] {
  if (typeof instructions === 'string') {
    return instructions.trim() ? [instructions.trim()] : []
  }

  if (!Array.isArray(instructions)) return []

  const steps: string[] = []

  for (const item of instructions) {
    if (typeof item === 'string') {
      if (item.trim()) steps.push(item.trim())
      continue
    }

    if (!item || typeof item !== 'object') continue

    const obj = item as Record<string, unknown>

    // HowToSection: has itemListElement with nested steps
    if (Array.isArray(obj.itemListElement)) {
      for (const subItem of obj.itemListElement) {
        if (typeof subItem === 'string') {
          if (subItem.trim()) steps.push(subItem.trim())
        } else if (subItem && typeof subItem === 'object') {
          const text = (subItem as Record<string, unknown>).text
          if (typeof text === 'string' && text.trim()) {
            steps.push(text.trim())
          }
        }
      }
      continue
    }

    // HowToStep: has text property
    if ('text' in obj && typeof obj.text === 'string' && obj.text.trim()) {
      steps.push(obj.text.trim())
    }
  }

  return steps
}

/**
 * Parse an ISO 8601 duration (e.g., "PT30M", "PT1H15M") to minutes.
 */
function parseDuration(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/)
  if (!match) return null
  const hours = parseInt(match[1] || '0', 10)
  const minutes = parseInt(match[2] || '0', 10)
  const total = hours * 60 + minutes
  return total > 0 ? total : null
}

/**
 * Strip HTML to plain text for recipe extraction.
 * Removes script/style/nav blocks, strips tags, collapses whitespace.
 */
export function stripHtmlToText(html: string): string {
  let text = html
  // Remove script, style, nav, header, footer blocks and their content
  text = text.replace(/<(script|style|nav|header|footer|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ')
  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim()
  return text
}

/**
 * Block private/internal URLs to prevent SSRF attacks.
 */
function validatePublicUrl(url: string): void {
  const parsedUrl = new URL(url)
  const hostname = parsedUrl.hostname.toLowerCase()

  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)
  ) {
    throw new RecipeParseError('Cannot fetch from private or local addresses.')
  }
}

/**
 * Fetch a URL and extract its text content for recipe parsing.
 * Throws RecipeParseError on failure.
 */
export async function fetchRecipeFromUrl(url: string): Promise<string> {
  validatePublicUrl(url)

  const allowed = await checkRobotsAllowed(url)
  if (!allowed) {
    throw new RecipeParseError(ROBOTS_DISALLOWED_MESSAGE)
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': HONKADORI_BOT_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new RecipeParseError(
        "We couldn't import from that URL. Try copying and pasting the recipe text directly instead.",
      )
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      throw new RecipeParseError(
        'The URL does not point to a web page. Please paste a link to a recipe page.',
      )
    }

    const html = await response.text()

    // Try JSON-LD extraction first (cleanest data from recipe sites)
    const jsonLdText = extractJsonLdRecipe(html)
    if (jsonLdText) {
      return jsonLdText
    }

    // Fall back to stripped HTML with truncation
    const text = stripHtmlToText(html).slice(0, MAX_STRIPPED_TEXT_LENGTH)

    if (text.length < 50) {
      throw new RecipeParseError(
        'Could not extract enough content from the URL. Try pasting the recipe text directly.',
      )
    }

    return text
  } catch (error) {
    if (error instanceof RecipeParseError) {
      throw error
    }
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new RecipeParseError(
        "We couldn't import from that URL. Try copying and pasting the recipe text directly instead.",
      )
    }
    throw new RecipeParseError(
      "We couldn't import from that URL. Try copying and pasting the recipe text directly instead.",
    )
  }
}

/**
 * Schema for a single extracted ingredient from recipe text.
 */
/**
 * Extracted ingredient schema for AI structured output.
 *
 * NOTE: Anthropic's structured output API has limited JSON Schema support.
 * Avoid .positive(), .min(), .max(), .int() on numbers — these generate
 * unsupported properties (exclusiveMinimum, minimum, maximum).
 * Encode constraints in .describe() instead.
 */
const ExtractedIngredientSchema = z.object({
  name: z.string().describe('The ingredient name without quantity (e.g., "chicken breast")'),
  quantity: z
    .number()
    .nullable()
    .describe('The numeric quantity (must be > 0), or null if vague (e.g., "to taste")'),
  unit: z
    .enum(['g', 'piece', 'ml', 'tbsp', 'tsp', 'cup', 'oz', 'lb'])
    .nullable()
    .describe('The unit of measurement, or null if vague'),
  originalText: z
    .string()
    .describe('The original text from the recipe (e.g., "2 chicken breasts")'),
  isVague: z
    .boolean()
    .describe('True if quantity is vague (e.g., "to taste", "a pinch", "for garnish", "optional")'),
  vaguePhrase: z
    .string()
    .nullable()
    .describe('The vague phrase if isVague is true (e.g., "to taste", "a pinch")'),
  isDried: z
    .boolean()
    .nullable()
    .describe('For herbs, whether the ingredient is dried (e.g., "dried basil")'),
})

/**
 * Schema for AI structured output of recipe extraction.
 *
 * NOTE: Anthropic's structured output API has limited JSON Schema support.
 * Avoid .positive(), .min(), .max(), .int() on numbers — these generate
 * unsupported properties (exclusiveMinimum, minimum, maximum).
 * Encode constraints in .describe() instead.
 */
export const RecipeExtractionSchema = z.object({
  name: z.string().describe('The recipe name (1-200 chars)'),
  description: z
    .string()
    .nullable()
    .describe('A brief description of the dish (max 1000 chars), or null if not found'),
  preparationNotes: z
    .string()
    .nullable()
    .describe(
      'Distilled preparation steps from the recipe text (max 5000 chars). Strip noise (ads, life stories, navigation) and return only essential cooking steps in a clean, numbered format. Null if no preparation steps found.',
    ),
  timeMinutes: z
    .number()
    .nullable()
    .describe('Total prep + cook time in minutes (integer, 1-480), or null if not specified'),
  servings: z
    .number()
    .describe('Number of servings the recipe makes (integer, 1-50, default to 4 if not specified)'),
  mealTypes: z
    .array(z.enum(['breakfast', 'lunch', 'dinner']))
    .describe('Which meal types this recipe is suitable for (at least one)'),
  kidFriendly: z
    .boolean()
    .describe('Whether this recipe is likely kid-friendly (no spicy ingredients, simple flavors)'),
  ingredients: z
    .array(ExtractedIngredientSchema)
    .describe('The list of ingredients with quantities (at least one)'),
  recipeConfidence: z
    .number()
    .describe(
      'How confident you are (0-100) that the input text contains an actual recipe with specific ingredients and quantities. 90-100 for structured recipes with clear ingredient lists. 50-89 for informal or partial recipes. Below 50 for non-recipe content (articles, stories, random text, code). If the text has no identifiable recipe at all, use 0-10.',
    ),
})

export type RecipeExtraction = z.infer<typeof RecipeExtractionSchema>
export type ExtractedIngredient = z.infer<typeof ExtractedIngredientSchema>

/**
 * Confidence tier for recipe extraction quality.
 */
export type ConfidenceTier = 'high' | 'medium' | 'low'

export interface ConfidenceResult {
  tier: ConfidenceTier
  message?: string
}

/**
 * Pattern guard: invalid recipe name patterns that indicate fabrication.
 */
const INVALID_NAME_PATTERNS = [
  /^error/i,
  /not found/i,
  /\bn\/a\b/i,
  /^untitled$/i,
  /^unknown$/i,
  /^none$/i,
  /^n\/a$/i,
]

/**
 * Pattern guard: invalid ingredient name patterns.
 */
const INVALID_INGREDIENT_PATTERNS = [/placeholder/i, /\berror\b/i, /\bexample\b/i, /\btest\b/i]

/**
 * Evaluate recipe extraction confidence using three layers:
 * 1. Pattern guards (force rejection on known fabrication signals)
 * 2. Post-AI heuristics (vague ratio, identical quantities, low count)
 * 3. AI confidence score (adjusted by heuristics)
 */
export function evaluateRecipeConfidence(extraction: RecipeExtraction): ConfidenceResult {
  // Layer 1: Pattern guards — always reject
  const nameLower = extraction.name.toLowerCase().trim()
  for (const pattern of INVALID_NAME_PATTERNS) {
    if (pattern.test(nameLower)) {
      return {
        tier: 'low',
        message:
          "This doesn't appear to contain a recipe. Try pasting the recipe text directly, or check that the page has a specific recipe with ingredients.",
      }
    }
  }

  const suspiciousIngredients = extraction.ingredients.filter((ing) => {
    const name = ing.name.toLowerCase().trim()
    return INVALID_INGREDIENT_PATTERNS.some((pattern) => pattern.test(name))
  })
  if (suspiciousIngredients.length > 0) {
    return {
      tier: 'low',
      message:
        "This doesn't appear to contain a recipe. Try pasting the recipe text directly, or check that the page has a specific recipe with ingredients.",
    }
  }

  // Layer 2: Post-AI heuristics
  let adjustedScore = extraction.recipeConfidence

  // Check vague ingredient ratio
  const vagueCount = extraction.ingredients.filter((ing) => ing.isVague).length
  const totalCount = extraction.ingredients.length
  if (totalCount > 0 && vagueCount / totalCount > 0.5) {
    adjustedScore -= 20
  }

  // Check for very few ingredients with no real quantities
  const ingredientsWithQuantities = extraction.ingredients.filter(
    (ing) => !ing.isVague && ing.quantity !== null && ing.quantity > 0,
  )
  if (totalCount < 3 && ingredientsWithQuantities.length === 0) {
    adjustedScore -= 30
  }

  // Check for identical quantities (hallucination pattern)
  if (totalCount >= 3) {
    const quantities = extraction.ingredients
      .filter((ing) => ing.quantity !== null)
      .map((ing) => ing.quantity)
    if (quantities.length >= 3) {
      const allSame = quantities.every((q) => q === quantities[0])
      if (allSame) {
        adjustedScore -= 25
      }
    }
  }

  // Layer 3: Map adjusted score to tier
  if (adjustedScore > 60) {
    return { tier: 'high' }
  }

  if (adjustedScore >= 30) {
    return {
      tier: 'medium',
      message:
        "We're not confident this is a complete recipe. The results may be incomplete or inaccurate.",
    }
  }

  return {
    tier: 'low',
    message:
      "This doesn't appear to contain a recipe. Try pasting the recipe text directly, or check that the page has a specific recipe with ingredients.",
  }
}

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
export function buildRecipeExtractionPrompt(recipeText: string): string {
  const vaguePhrasesList = VAGUE_PHRASES.join(', ')

  return `You are a recipe parsing assistant. Extract structured data from the following recipe text.

IMPORTANT GUIDELINES:
1. Extract the recipe name, description, cooking time, servings, ingredients, and preparation steps
2. For ingredients, extract the quantity, unit, and ingredient name separately
3. Use these units: "g" for weight, "ml" for volume, "piece" for countable items, or keep original units ("cup", "tbsp", "tsp", "oz", "lb") if conversion would be inaccurate

INGREDIENT NAME SPECIFICITY (CRITICAL):
Use specific ingredient names when the database has them. Keep generic names when that's what the database stores.

| Ambiguous Text | Correct Output | Rationale |
|----------------|----------------|-----------|
| "salt and pepper to taste" | "black pepper" | DB has "black pepper" (specific) |
| "1 red pepper, diced" | "red bell pepper" | DB has "red bell pepper" (specific) |
| "sauté the onion" | "onion" | DB has "onion" (generic) |
| "add the oil" | "vegetable oil" | DB has "vegetable oil" (specific) |
| "1 cup milk" | "milk" | DB has "milk" (generic) |
| "butter for greasing" | "butter" | DB has "butter" (generic) |
| "1 cup rice" | "white rice" | DB has "white rice" (specific) |
| "a splash of vinegar" | "vinegar" | DB has "vinegar" (generic) |
| "top with cream" | "heavy cream" | DB has "heavy cream" (specific) |
| "2 tbsp extra virgin olive oil" | "olive oil" | DB has "olive oil" (strip quality grade) |
| "1 tbsp virgin olive oil" | "olive oil" | DB has "olive oil" (strip quality grade) |
| "light olive oil" | "olive oil" | DB has "olive oil" (strip quality grade) |
| "2 cans peeled tomatoes" | "canned whole peeled tomatoes" | DB has "canned whole peeled tomatoes" (specific) |
| "1 can whole tomatoes" | "canned whole peeled tomatoes" | DB has "canned whole peeled tomatoes" (specific) |
| "1 can diced tomatoes" | "canned diced tomatoes" | DB has "canned diced tomatoes" (specific) |
| "1 can chopped tomatoes" | "canned diced tomatoes" | DB has "canned diced tomatoes" (specific) |

QUALITY/PROCESSING QUALIFIERS TO STRIP:
Some ingredients have quality grades or processing descriptors that should be stripped because the DB stores only the base ingredient:
- Olive oil: "extra virgin", "virgin", "light", "pure", "cold pressed" → output "olive oil"
- These describe quality grades, not different products

Expand generic terms ONLY when the database has the specific variant (pepper → black pepper, rice → white rice, oil → vegetable oil, cream → heavy cream).
Keep generic terms when that's what the database stores (onion, milk, butter, vinegar, olive oil).

VAGUE QUANTITY DETECTION:
Some ingredients have imprecise quantities. Detect these vague phrases:
${vaguePhrasesList}

When you detect a vague phrase:
- Set isVague: true
- Set vaguePhrase to the detected phrase (e.g., "to taste", "a pinch")
- Set quantity: null and unit: null
- Keep the ingredient name clean (without the vague phrase)

Examples:
- "salt to taste" → name: "salt", isVague: true, vaguePhrase: "to taste", quantity: null, unit: null
- "a pinch of paprika" → name: "paprika", isVague: true, vaguePhrase: "a pinch", quantity: null, unit: null
- "fresh parsley for garnish" → name: "parsley", isVague: true, vaguePhrase: "for garnish", quantity: null, unit: null
- "dried basil (optional)" → name: "basil", isVague: true, vaguePhrase: "optional", quantity: null, unit: null, isDried: true

DRIED HERBS:
If an herb is explicitly "dried" (e.g., "dried oregano", "1 tsp dried basil"), set isDried: true.
If not specified or clearly fresh (e.g., "fresh basil", "basil leaves"), set isDried: false or null.

CRITICAL QUANTITY RULES (for non-vague ingredients):
- For countable items (eggs, garlic cloves, chicken breasts, onions), use "piece" as unit with the COUNT as quantity
  Example: "4 cloves garlic" → quantity: 4, unit: "piece", name: "garlic"
  Example: "2 chicken breasts" → quantity: 2, unit: "piece", name: "chicken breast"
- For canned items: "can" is NOT a supported unit. Convert to grams: 1 standard can ≈ 400g
  Example: "2 cans peeled tomatoes" → quantity: 800, unit: "g", name: "canned whole peeled tomatoes"
  Example: "1 can diced tomatoes" → quantity: 400, unit: "g", name: "canned diced tomatoes"
  Example: "1 can coconut milk" → quantity: 400, unit: "g", name: "coconut milk"
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

PREPARATION NOTES (IMPORTANT — always attempt extraction):
Extract cooking/preparation steps from the recipe text into the preparationNotes field.
- Look for ANY instructions, directions, method, or steps — even if they appear as prose rather than a numbered list
- Distill them into clean, numbered steps (e.g., "1. Preheat oven to 200°C\n2. Mix flour and salt...")
- Strip noise: blog content, personal stories, ads, navigation text, "jump to recipe" links
- Focus on actionable cooking instructions only
- If the source genuinely has no preparation steps at all, set preparationNotes to null — do NOT fabricate steps

RECIPE TEXT:
${recipeText}

RECIPE CONFIDENCE SCORING:
Rate your confidence (0-100) that this text contains a real recipe:
- 90-100: Structured recipe with clear name, ingredients list, and quantities
- 70-89: Recognizable recipe but informal format or missing some details
- 50-69: Might be a recipe but very incomplete or ambiguous
- 20-49: Unlikely to be a recipe (food-related article, general food discussion)
- 0-19: Definitely not a recipe (random text, code, news, lorem ipsum)
Be honest — if the text is not a recipe, give a low score even if you can extract something.

Extract the structured recipe data.`
}

/**
 * Result of parsing recipe text, including confidence evaluation.
 */
export interface ParseRecipeResult {
  extraction: RecipeExtraction
  confidence: ConfidenceResult
}

/**
 * Parse recipe text using AI to extract structured data.
 * Throws RecipeParseError if the text doesn't contain enough information or confidence is low.
 */
export async function parseRecipeText(
  recipeText: string,
  onAiUsage?: (usage: AiUsageStats) => void,
): Promise<ParseRecipeResult> {
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
    const result = await generateObject({
      model: anthropic(RECIPE_MODEL),
      schema: RecipeExtractionSchema,
      prompt,
    })

    const { object } = result

    onAiUsage?.({
      model: RECIPE_MODEL,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
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

    // Evaluate confidence
    const confidence = evaluateRecipeConfidence(object)
    if (confidence.tier === 'low') {
      throw new RecipeParseError(
        confidence.message ??
          "This doesn't appear to contain a recipe. Try pasting the recipe text directly.",
      )
    }

    return { extraction: object, confidence }
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
 * Minimum similarity score for a match to be considered "confident".
 * Below this threshold, we show disambiguation UI to the user.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6

/**
 * Floor threshold for showing "verify match" suggestions.
 * Matches below this score are too unreliable to suggest — they're treated
 * as fully unmatched rather than shown as low-confidence suggestions.
 *
 * Examples of false positives this threshold filters out:
 * - "fajita seasoning" → "italian seasoning"
 * - "red chili pepper" → "red bell pepper" (similarity ~0.53, semantically wrong)
 *
 * Raised from 0.5 to 0.55 to prevent similar-sounding but semantically different
 * ingredients from being suggested as verify-matches.
 */
export const VERY_LOW_CONFIDENCE_THRESHOLD = 0.55

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
    subcategory: string | null
    defaultUnit: Unit
    gramsPerPiece: number | null
    calories: number
    protein: number
    carbs: number
    fat: number
  }
  /** Quantity converted to the ingredient's default unit */
  convertedQuantity: number
  /** Warning if quantity seems unusually high */
  quantityWarning?: string
  /** True if quantity was vague (e.g., "to taste") */
  isVague: boolean
  /** The original vague phrase if isVague is true */
  originalPhrase?: string
  /** Similarity score from trigram matching (0-1) */
  similarityScore: number
  /** True if match confidence is low and needs user disambiguation */
  lowConfidence: boolean
  /** Alternative ingredient candidates for disambiguation (only when lowConfidence is true) */
  alternatives?: Array<{
    id: string
    name: string
    category: IngredientCategory
    defaultUnit: Unit
    similarity: number
  }>
}

export interface UnmatchedIngredient {
  type: 'unmatched'
  extractedName: string
  extractedQuantity: number
  extractedUnit: string
  originalText: string
  /** True if quantity was vague (e.g., "to taste") */
  isVague: boolean
  /** The original vague phrase if isVague is true */
  originalPhrase?: string
}

export type IngredientMatchResult = MatchedIngredient | UnmatchedIngredient

/**
 * Result of the full recipe parsing and matching process.
 */
export interface ParsedRecipe {
  name: string
  description: string | null
  preparationNotes: string | null
  sourceUrl: string | null
  timeMinutes: number | null
  servings: number
  mealTypes: MealType[]
  kidFriendly: boolean
  ingredients: IngredientMatchResult[]
  allMatched: boolean
  confidenceTier: ConfidenceTier
  confidenceWarning?: string
}

/**
 * Minimum similarity score for fuzzy ingredient matching.
 * Raised from 0.3 to 0.45 to prevent false positives like "baking powder" → "curry powder".
 */
export const SIMILARITY_THRESHOLD = 0.45

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

export type IngredientMatchSource = 'global' | 'household' | 'translation'

export type FuzzyIngredientMatch = {
  id: string
  name: string
  category: IngredientCategory
  subcategory: string | null
  defaultUnit: Unit
  gramsPerPiece: number | null
  calories: number
  protein: number
  carbs: number
  fat: number
  similarity: number
  source: IngredientMatchSource
}

/**
 * Perform fuzzy search for an ingredient name using pg_trgm across:
 *   1. Global pool (`householdId IS NULL`) — priority 1
 *   2. Household-scoped pool (`householdId = ?`) — priority 2 (only if `householdId` provided)
 *   3. Translation table for the requested locale — priority 3 (only if `locale` non-default)
 *
 * Results are ordered by source priority then similarity, so a global canonical
 * match always wins over a household-scoped or translation-only match. The
 * returned `name` is always the canonical English `ingredient.name` even when
 * matched via a translation row — callers translate for display via
 * `@/lib/i18n/content`.
 *
 * WHY: Translation-based matching reliability depends on Estonian translation
 * data being seeded (HON-506). Until then, the translation branch returns no
 * rows in practice and behaviour matches pre-i18n state.
 */
export async function fuzzySearchIngredient(
  searchName: string,
  options: { householdId?: string | null; locale?: string } = {},
): Promise<FuzzyIngredientMatch[]> {
  const householdIdParam = options.householdId ?? null
  const locale = options.locale ?? DEFAULT_LOCALE
  const localeParam = locale === DEFAULT_LOCALE ? null : locale

  return prisma.$queryRaw<FuzzyIngredientMatch[]>`
    SELECT * FROM (
      SELECT
        id,
        name,
        category,
        subcategory,
        "defaultUnit",
        "gramsPerPiece",
        calories,
        protein,
        carbs,
        fat,
        similarity(name, ${searchName}) AS similarity,
        'global'::text AS source,
        1 AS source_priority
      FROM "ingredient"
      WHERE "householdId" IS NULL
        AND similarity(name, ${searchName}) >= ${SIMILARITY_THRESHOLD}

      UNION ALL

      SELECT
        id,
        name,
        category,
        subcategory,
        "defaultUnit",
        "gramsPerPiece",
        calories,
        protein,
        carbs,
        fat,
        similarity(name, ${searchName}) AS similarity,
        'household'::text AS source,
        2 AS source_priority
      FROM "ingredient"
      WHERE "householdId" = ${householdIdParam}::text
        AND similarity(name, ${searchName}) >= ${SIMILARITY_THRESHOLD}

      UNION ALL

      SELECT
        i.id,
        i.name,
        i.category,
        i.subcategory,
        i."defaultUnit",
        i."gramsPerPiece",
        i.calories,
        i.protein,
        i.carbs,
        i.fat,
        similarity(t.name, ${searchName}) AS similarity,
        'translation'::text AS source,
        3 AS source_priority
      FROM "ingredient_translation" t
      INNER JOIN "ingredient" i ON i.id = t."ingredientId"
      WHERE t.locale = ${localeParam}::text
        AND similarity(t.name, ${searchName}) >= ${SIMILARITY_THRESHOLD}
        AND (i."householdId" IS NULL OR i."householdId" = ${householdIdParam}::text)
    ) AS results
    ORDER BY source_priority ASC, similarity DESC
    LIMIT 4
  `
}

/**
 * Match extracted ingredients against the database using fuzzy search.
 * Tries direct match first, then falls back to alias expansion if needed.
 *
 * @param extractedIngredients - The ingredients extracted by AI
 * @param servings - Number of servings for quantity validation
 * @param options.householdId - Used to also search the household's own ingredient pool
 *                              (in addition to the global seeded pool).
 * @param options.locale - Used to also search `ingredient_translation` rows for the
 *                         locale, so a query like "sibul" can find the English `onion`.
 */
export async function matchIngredients(
  extractedIngredients: ExtractedIngredient[],
  servings: number,
  options: { householdId?: string | null; locale?: string } = {},
): Promise<IngredientMatchResult[]> {
  const results: IngredientMatchResult[] = []
  const searchOptions = { householdId: options.householdId, locale: options.locale }

  for (const extracted of extractedIngredients) {
    const directName = extracted.name.toLowerCase().trim()

    // Build candidate search names (deduplicated, in priority order)
    const candidateNames = new Set<string>()
    candidateNames.add(directName)

    // Alias expansion
    const expandedName = applyIngredientAlias(extracted.name)
    const aliasName = expandedName.toLowerCase().trim()
    candidateNames.add(aliasName)

    // Normalized name (strip modifiers + singularize)
    const normalizedName = normalizeIngredientName(directName)
    candidateNames.add(normalizedName)

    // Alias of normalized name
    const normalizedAliasName = applyIngredientAlias(normalizedName).toLowerCase().trim()
    candidateNames.add(normalizedAliasName)

    // Phase 1: Search semantic candidates (direct, alias, normalized, alias-normalized)
    let matches: Awaited<ReturnType<typeof fuzzySearchIngredient>> = []
    for (const candidate of candidateNames) {
      const candidateMatches = await fuzzySearchIngredient(candidate, searchOptions)
      if (candidateMatches[0] && candidateMatches[0].similarity > (matches[0]?.similarity ?? 0)) {
        matches = candidateMatches
      }
    }

    // Phase 2: Last-word fallback — ONLY if no semantic match found above threshold
    // This prevents "trout fillet" → "fillet" → "cod fillet" from overriding
    // the direct search result when a reasonable match already exists.
    // Uses VERY_LOW_CONFIDENCE_THRESHOLD because matches below it would be treated
    // as unmatched anyway — so the fallback can only improve the outcome.
    if (!matches[0] || matches[0].similarity < VERY_LOW_CONFIDENCE_THRESHOLD) {
      const lastWord = extractLastWord(directName)
      if (lastWord) {
        const fallbackMatches = await fuzzySearchIngredient(lastWord, searchOptions)
        if (fallbackMatches[0] && fallbackMatches[0].similarity > (matches[0]?.similarity ?? 0)) {
          // Safety: only accept fallback if the last word appears as a complete word
          // in the matched name. Prevents "sausage" → "sage" (substring trigram match)
          // while allowing "sauce" → "soy sauce" and "bread" → "bread".
          const matchedWords = new Set(fallbackMatches[0].name.toLowerCase().split(/\s+/))
          if (matchedWords.has(lastWord)) {
            matches = fallbackMatches
          }
        }
      }
    }

    if (matches.length > 0 && matches[0]) {
      const match = matches[0]
      const similarityScore = match.similarity

      // Very low similarity — treat as unmatched to avoid misleading suggestions
      if (similarityScore < VERY_LOW_CONFIDENCE_THRESHOLD) {
        results.push({
          type: 'unmatched',
          extractedName: extracted.name,
          extractedQuantity: extracted.quantity ?? 0,
          extractedUnit: extracted.unit ?? 'g',
          originalText: extracted.originalText,
          isVague: extracted.isVague,
          originalPhrase: extracted.vaguePhrase ?? undefined,
        })
        continue
      }

      let lowConfidence = similarityScore < LOW_CONFIDENCE_THRESHOLD

      // Safety check: if primary nouns differ between extracted and matched name,
      // force low-confidence regardless of trigram score.
      // e.g., "trout fillet" → "cod fillet": trout ≠ cod → flag for review
      if (!lowConfidence && directName.includes(' ')) {
        const COMMON_SUFFIXES = new Set([
          'fillet',
          'breast',
          'thigh',
          'leg',
          'wing',
          'steak',
          'chop',
          'loin',
          'rib',
        ])
        const extractedWords = new Set(directName.split(/\s+/))
        const matchedWords = new Set(match.name.toLowerCase().split(/\s+/))

        const extractedUnique = [...extractedWords].filter(
          (w) => !matchedWords.has(w) && !COMMON_SUFFIXES.has(w),
        )
        const matchedUnique = [...matchedWords].filter(
          (w) => !extractedWords.has(w) && !COMMON_SUFFIXES.has(w),
        )

        if (extractedUnique.length > 0 && matchedUnique.length > 0) {
          lowConfidence = true
        }
      }

      // Get alternatives for disambiguation if low confidence
      const alternatives = lowConfidence
        ? matches.slice(0, 3).map((m) => ({
            id: m.id,
            name: m.name,
            category: m.category,
            defaultUnit: m.defaultUnit,
            similarity: m.similarity,
          }))
        : undefined

      // Handle vague quantities
      let convertedQuantity: number
      let isVague = extracted.isVague
      let originalPhrase = extracted.vaguePhrase ?? undefined
      let quantityWarning: string | undefined
      let vagueResult: VagueQuantityResult | null = null

      if (isVague && originalPhrase) {
        // Apply rule-based default for vague quantity
        vagueResult = getVagueDefault(
          match.category,
          match.subcategory,
          originalPhrase,
          extracted.isDried ?? undefined,
        )

        if (vagueResult) {
          // Quantity from vagueResult is per-serving, but we store total quantity for recipe
          // The convertedQuantity here represents total for the recipe (all servings)
          convertedQuantity = vagueResult.quantity * servings
        } else {
          // Fallback: use 10g per serving as default
          convertedQuantity = 10 * servings
        }
      } else if (extracted.quantity !== null && extracted.unit !== null) {
        // Normal quantity conversion
        convertedQuantity = convertQuantity(extracted.quantity, extracted.unit, match)

        // Calculate per-serving for validation
        const quantityPerServing = convertedQuantity / servings

        // Check guardrails for non-vague quantities
        quantityWarning = checkGuardrail(quantityPerServing, match.category, match.subcategory)

        // Also check general reasonableness
        if (!quantityWarning) {
          let totalGrams = convertedQuantity
          if (match.defaultUnit === 'piece') {
            totalGrams = convertedQuantity * (match.gramsPerPiece ?? DEFAULT_GRAMS_PER_PIECE)
          }

          if (!isReasonableQuantity(totalGrams, servings)) {
            const gramsPerServing = Math.round(totalGrams / servings)
            quantityWarning = `Unusually high: ${gramsPerServing}g per serving. Please verify this amount.`
          }
        }
      } else {
        // Shouldn't happen, but fallback
        convertedQuantity = 10 * servings
        isVague = true
        originalPhrase = 'some'
      }

      results.push({
        type: 'matched',
        extractedName: extracted.name,
        extractedQuantity: extracted.quantity ?? 0,
        extractedUnit: extracted.unit ?? 'g',
        originalText: extracted.originalText,
        ingredient: {
          id: match.id,
          name: match.name,
          category: match.category,
          subcategory: match.subcategory,
          defaultUnit: match.defaultUnit,
          gramsPerPiece: match.gramsPerPiece,
          calories: match.calories,
          protein: match.protein,
          carbs: match.carbs,
          fat: match.fat,
        },
        convertedQuantity,
        quantityWarning,
        isVague,
        originalPhrase,
        similarityScore,
        lowConfidence,
        alternatives,
      })
    } else {
      results.push({
        type: 'unmatched',
        extractedName: extracted.name,
        extractedQuantity: extracted.quantity ?? 0,
        extractedUnit: extracted.unit ?? 'g',
        originalText: extracted.originalText,
        isVague: extracted.isVague,
        originalPhrase: extracted.vaguePhrase ?? undefined,
      })
    }
  }

  return mergeDuplicateIngredients(results, servings)
}

/**
 * Merge duplicate matched ingredients (same ingredientId) into single rows.
 * Quantities are summed. If either row is vague, the merged row is vague with no quantity.
 * Unmatched ingredients pass through unchanged.
 * Re-runs guardrail checks on summed quantities since individually-valid amounts may exceed
 * thresholds when combined.
 */
export function mergeDuplicateIngredients(
  results: IngredientMatchResult[],
  servings: number,
): IngredientMatchResult[] {
  const merged: IngredientMatchResult[] = []
  const matchedById = new Map<string, MatchedIngredient>()

  for (const result of results) {
    if (result.type !== 'matched') {
      merged.push(result)
      continue
    }

    const id = result.ingredient.id
    const existing = matchedById.get(id)

    if (!existing) {
      matchedById.set(id, result)
      continue
    }

    // Merge: if either is vague, result is vague with zero quantity
    if (existing.isVague || result.isVague) {
      matchedById.set(id, {
        ...existing,
        convertedQuantity: 0,
        isVague: true,
        originalPhrase: existing.originalPhrase ?? result.originalPhrase,
        originalText: `${existing.originalText} + ${result.originalText}`,
        quantityWarning: undefined,
      })
    } else {
      // Both have quantities — sum them, re-run guardrails on combined total
      const summedQuantity = existing.convertedQuantity + result.convertedQuantity
      const { category, subcategory, defaultUnit, gramsPerPiece } = existing.ingredient
      const quantityPerServing = summedQuantity / servings

      let quantityWarning = checkGuardrail(quantityPerServing, category, subcategory)
      if (!quantityWarning) {
        let totalGrams = summedQuantity
        if (defaultUnit === 'piece') {
          totalGrams = summedQuantity * (gramsPerPiece ?? DEFAULT_GRAMS_PER_PIECE)
        }
        if (!isReasonableQuantity(totalGrams, servings)) {
          const gramsPerServing = Math.round(totalGrams / servings)
          quantityWarning = `Unusually high: ${gramsPerServing}g per serving. Please verify this amount.`
        }
      }

      matchedById.set(id, {
        ...existing,
        convertedQuantity: summedQuantity,
        originalText: `${existing.originalText} + ${result.originalText}`,
        quantityWarning,
      })
    }
  }

  // Build final array preserving original order.
  // Walk the original results: emit each unmatched as-is,
  // emit each matched ingredient at its first occurrence (merged).
  const unmatchedResults = merged
  const finalResults: IngredientMatchResult[] = []
  let unmatchedIndex = 0
  const emittedIds = new Set<string>()

  for (const result of results) {
    if (result.type !== 'matched') {
      finalResults.push(unmatchedResults[unmatchedIndex]!)
      unmatchedIndex++
    } else {
      const id = result.ingredient.id
      if (!emittedIds.has(id)) {
        emittedIds.add(id)
        finalResults.push(matchedById.get(id)!)
      }
    }
  }

  return finalResults
}

/**
 * Parse recipe text and match ingredients against the database.
 * This is the main entry point for the recipe import feature.
 *
 * @param recipeText - The recipe text to parse
 * @param sourceUrl - Optional source URL for URL imports (stored as dedicated field)
 * @param onAiUsage - Callback for tracking AI usage stats
 * @param matchOptions - Household + locale context for ingredient matching
 */
export async function parseAndMatchRecipe(
  recipeText: string,
  sourceUrl?: string,
  onAiUsage?: (usage: AiUsageStats) => void,
  matchOptions: { householdId?: string | null; locale?: string } = {},
): Promise<ParsedRecipe> {
  // Step 1: Extract structured data from text (low confidence throws)
  const { extraction, confidence } = await parseRecipeText(recipeText, onAiUsage)

  // Step 2: Match ingredients against database (pass servings for validation)
  const ingredientResults = await matchIngredients(
    extraction.ingredients,
    extraction.servings,
    matchOptions,
  )

  // Step 3: Check if all ingredients matched
  const allMatched = ingredientResults.every((r) => r.type === 'matched')

  return {
    name: extraction.name,
    description: extraction.description,
    preparationNotes: extraction.preparationNotes,
    sourceUrl: sourceUrl ?? null,
    timeMinutes: extraction.timeMinutes,
    servings: extraction.servings,
    mealTypes: extraction.mealTypes as MealType[],
    kidFriendly: extraction.kidFriendly,
    ingredients: ingredientResults,
    allMatched,
    confidenceTier: confidence.tier,
    confidenceWarning: confidence.message,
  }
}
