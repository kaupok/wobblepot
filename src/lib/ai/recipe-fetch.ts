import { WOBBLEPOT_BOT_USER_AGENT, checkRobotsAllowed } from '@/lib/robots'
import { RecipeParseError } from './recipe-errors'

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
        'User-Agent': WOBBLEPOT_BOT_USER_AGENT,
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
