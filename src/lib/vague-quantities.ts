import type { IngredientCategory } from '@/generated/prisma/enums'

/**
 * Recognized vague phrases in recipe ingredients.
 * These indicate imprecise quantities that vary by cook preference.
 */
export const VAGUE_PHRASES = [
  'to taste',
  'a pinch',
  'pinch',
  'a dash',
  'dash',
  'a splash',
  'splash',
  'a drizzle',
  'drizzle',
  'a handful',
  'handful',
  'some',
  'for garnish',
  'garnish',
  'optional',
  'as needed',
  'a bit',
  'a little',
] as const

export type VaguePhrase = (typeof VAGUE_PHRASES)[number]

/**
 * Extended category for vague quantity rules.
 * Maps ingredient categories and subcategories to rule categories.
 */
export type VagueCategory =
  | 'mineral' // salt
  | 'spice' // dry spices
  | 'herb_fresh' // fresh herbs
  | 'herb_dried' // dried herbs
  | 'oil' // cooking oils
  | 'acid' // vinegar, citrus
  | 'condiment' // sauces, pastes
  | 'sauce' // liquid sauces
  | 'seasoning' // mixed seasonings
  | 'allium' // garlic, onion, shallot
  | 'default' // fallback

/**
 * Phrase groups for rule matching.
 */
type PhraseGroup = 'taste_pinch' | 'drizzle_splash' | 'garnish' | 'handful_some'

/**
 * Map phrase to phrase group.
 */
function getPhraseGroup(phrase: string): PhraseGroup | null {
  const normalized = phrase.toLowerCase().trim()

  if (
    normalized === 'to taste' ||
    normalized === 'a pinch' ||
    normalized === 'pinch' ||
    normalized === 'a dash' ||
    normalized === 'dash' ||
    normalized === 'optional'
  ) {
    return 'taste_pinch'
  }

  if (
    normalized === 'a drizzle' ||
    normalized === 'drizzle' ||
    normalized === 'a splash' ||
    normalized === 'splash'
  ) {
    return 'drizzle_splash'
  }

  if (normalized === 'for garnish' || normalized === 'garnish') {
    return 'garnish'
  }

  if (
    normalized === 'a handful' ||
    normalized === 'handful' ||
    normalized === 'some' ||
    normalized === 'as needed' ||
    normalized === 'a bit' ||
    normalized === 'a little'
  ) {
    return 'handful_some'
  }

  return null
}

/**
 * Rule-based defaults by category and phrase group.
 * Values are per-serving quantities in grams (or ml for liquids, treated as grams).
 *
 * null means this combination doesn't make sense (e.g., "handful of salt").
 */
const VAGUE_DEFAULTS: Record<VagueCategory, Record<PhraseGroup, number | null>> = {
  mineral: {
    taste_pinch: 1,
    drizzle_splash: null,
    garnish: null,
    handful_some: null,
  },
  spice: {
    taste_pinch: 0.5,
    drizzle_splash: null,
    garnish: 0.5,
    handful_some: 2,
  },
  herb_fresh: {
    taste_pinch: null,
    drizzle_splash: null,
    garnish: 5,
    handful_some: 10,
  },
  herb_dried: {
    taste_pinch: 0.5,
    drizzle_splash: null,
    garnish: 0.5,
    handful_some: 2,
  },
  oil: {
    taste_pinch: 5,
    drizzle_splash: 10,
    garnish: 5,
    handful_some: null,
  },
  acid: {
    taste_pinch: 5,
    drizzle_splash: 10,
    garnish: 5,
    handful_some: null,
  },
  condiment: {
    taste_pinch: 5,
    drizzle_splash: 10,
    garnish: 5,
    handful_some: null,
  },
  sauce: {
    taste_pinch: 15,
    drizzle_splash: 15,
    garnish: 10,
    handful_some: null,
  },
  seasoning: {
    taste_pinch: 2,
    drizzle_splash: null,
    garnish: 2,
    handful_some: 5,
  },
  allium: {
    taste_pinch: 5,
    drizzle_splash: null,
    garnish: 5,
    handful_some: 15,
  },
  default: {
    taste_pinch: 5,
    drizzle_splash: 10,
    garnish: 5,
    handful_some: 10,
  },
}

/**
 * Guardrail thresholds: max reasonable quantity per serving.
 * If AI outputs above this, flag for user review.
 */
const GUARDRAIL_THRESHOLDS: Partial<Record<VagueCategory, number>> = {
  mineral: 3, // 3g salt max per serving
  spice: 2, // 2g spice max per serving
  herb_fresh: 15, // 15g fresh herbs max per serving
  herb_dried: 5, // 5g dried herbs max per serving
  oil: 30, // 30ml oil max per serving
}

/**
 * Subcategories that map to specific vague categories.
 */
const SUBCATEGORY_TO_VAGUE_CATEGORY: Record<string, VagueCategory> = {
  mineral: 'mineral',
  salt: 'mineral',
  herb: 'herb_fresh',
  'herb (fresh)': 'herb_fresh',
  'herb (dried)': 'herb_dried',
  'dried herb': 'herb_dried',
  oil: 'oil',
  acid: 'acid',
  vinegar: 'acid',
  citrus: 'acid',
  sauce: 'sauce',
  allium: 'allium',
  garlic: 'allium',
  onion: 'allium',
  seasoning: 'seasoning',
}

/**
 * Map ingredient category to vague category.
 */
const CATEGORY_TO_VAGUE_CATEGORY: Partial<Record<IngredientCategory, VagueCategory>> = {
  spice: 'spice',
  condiment: 'condiment',
  fat: 'oil',
}

/**
 * Determine the vague category for an ingredient.
 */
export function getVagueCategory(
  category: IngredientCategory,
  subcategory: string | null | undefined,
  isDried?: boolean,
): VagueCategory {
  // Check subcategory first (more specific)
  if (subcategory) {
    const normalized = subcategory.toLowerCase().trim()
    const vagueCategory = SUBCATEGORY_TO_VAGUE_CATEGORY[normalized]
    if (vagueCategory) {
      // Handle fresh vs dried herbs
      if (vagueCategory === 'herb_fresh' && isDried) {
        return 'herb_dried'
      }
      return vagueCategory
    }
  }

  // Fall back to main category
  const vagueCategory = CATEGORY_TO_VAGUE_CATEGORY[category]
  if (vagueCategory) {
    return vagueCategory
  }

  return 'default'
}

/**
 * Check if a phrase is a recognized vague phrase.
 */
export function isVaguePhrase(phrase: string): boolean {
  const normalized = phrase.toLowerCase().trim()
  return VAGUE_PHRASES.some((vp) => normalized === vp || normalized.includes(vp))
}

/**
 * Extract the vague phrase from text if present.
 */
export function extractVaguePhrase(text: string): string | null {
  const normalized = text.toLowerCase().trim()

  for (const phrase of VAGUE_PHRASES) {
    if (normalized === phrase || normalized.includes(phrase)) {
      return phrase
    }
  }

  return null
}

export interface VagueQuantityResult {
  quantity: number
  isVague: true
  originalPhrase: string
}

/**
 * Get the rule-based default quantity for a vague ingredient.
 *
 * @param category - Ingredient category
 * @param subcategory - Ingredient subcategory (optional)
 * @param phrase - The vague phrase (e.g., "to taste", "a pinch")
 * @param isDried - Whether the ingredient is dried (for herbs)
 * @returns The default quantity per serving, or null if combination doesn't make sense
 */
export function getVagueDefault(
  category: IngredientCategory,
  subcategory: string | null | undefined,
  phrase: string,
  isDried?: boolean,
): VagueQuantityResult | null {
  const phraseGroup = getPhraseGroup(phrase)
  if (!phraseGroup) {
    return null
  }

  const vagueCategory = getVagueCategory(category, subcategory, isDried)
  const defaults = VAGUE_DEFAULTS[vagueCategory]
  const quantity = defaults[phraseGroup]

  if (quantity === null) {
    // Use default category fallback
    const fallbackQuantity = VAGUE_DEFAULTS.default[phraseGroup]
    if (fallbackQuantity === null) {
      return null
    }
    return {
      quantity: fallbackQuantity,
      isVague: true,
      originalPhrase: phrase,
    }
  }

  return {
    quantity,
    isVague: true,
    originalPhrase: phrase,
  }
}

/**
 * Check if a quantity exceeds the guardrail threshold for a category.
 *
 * @param quantityPerServing - The quantity per serving
 * @param category - Ingredient category
 * @param subcategory - Ingredient subcategory (optional)
 * @returns Warning message if threshold exceeded, undefined otherwise
 */
export function checkGuardrail(
  quantityPerServing: number,
  category: IngredientCategory,
  subcategory: string | null | undefined,
): string | undefined {
  const vagueCategory = getVagueCategory(category, subcategory)
  const threshold = GUARDRAIL_THRESHOLDS[vagueCategory]

  if (threshold && quantityPerServing > threshold) {
    return `Unusually high: ${Math.round(quantityPerServing)}g per serving exceeds typical ${threshold}g max. Please verify.`
  }

  return undefined
}

/**
 * Format a vague phrase for display.
 * Capitalizes first letter and ensures consistent formatting.
 */
export function formatVaguePhrase(phrase: string): string {
  const normalized = phrase.toLowerCase().trim()

  // Special cases for better display
  if (normalized === 'to taste') return 'to taste'
  if (normalized === 'for garnish' || normalized === 'garnish') return 'for garnish'
  if (normalized === 'optional') return 'optional'
  if (normalized === 'as needed') return 'as needed'

  // For phrases like "a pinch", "a drizzle", etc.
  return normalized
}
