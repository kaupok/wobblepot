/**
 * Ingredient name normalization for improved fuzzy matching.
 *
 * Strips common cooking modifiers and plurals so that AI-generated names
 * like "fresh chives" or "eggs" match database entries "chives" and "egg".
 */

/**
 * Common cooking adjectives/modifiers that appear before ingredient names.
 * These are stripped to improve fuzzy matching against the database.
 */
const COOKING_MODIFIERS = new Set([
  // Freshness / state
  'fresh',
  'dried',
  'dry',
  'frozen',
  'canned',
  'raw',
  'cooked',
  'ripe',
  'unripe',

  // Preparation method
  'sliced',
  'chopped',
  'minced',
  'diced',
  'crushed',
  'grated',
  'shredded',
  'julienned',
  'cubed',
  'mashed',
  'peeled',
  'deseeded',
  'pitted',
  'trimmed',
  'halved',
  'quartered',
  'torn',

  // Texture / size
  'thin',
  'thick',
  'fine',
  'coarse',
  'large',
  'small',
  'medium',
  'baby',

  // Cooking state
  'toasted',
  'roasted',
  'grilled',
  'fried',
  'boiled',
  'steamed',
  'smoked',
  'blanched',
  'sauteed',
  'sautéed',
  'baked',
  'braised',
  'poached',
  'marinated',
  'pickled',
  'fermented',
  'caramelized',

  // Temperature
  'warm',
  'cold',
  'hot',
  'chilled',
  'room-temperature',

  // Processing
  'ground',
  'powdered',
  'whole',
  'flaked',
  'crumbled',

  // Quality / type modifiers
  'organic',
  'boneless',
  'skinless',
  'seedless',
  'unsalted',
  'salted',
  'sweetened',
  'unsweetened',
  'extra-virgin',
  'virgin',
])

/**
 * Words that should NOT be treated as strippable modifiers even though
 * they appear adjective-like. These are integral to the ingredient identity.
 */
const MODIFIER_EXCEPTIONS = new Set([
  'black', // black beans, black pepper
  'white', // white rice, white wine
  'red', // red wine, red lentils
  'green', // green lentils, green beans
  'brown', // brown rice, brown sugar
  'yellow', // yellow mustard
  'dark', // dark chocolate
  'light', // light soy sauce
  'sweet', // sweet potato
  'sour', // sour cream
  'hot', // hot sauce (but "hot" is also in COOKING_MODIFIERS - we handle via exceptions)
  'plain', // plain yogurt
  'heavy', // heavy cream
  'all-purpose', // all-purpose flour
  'self-raising', // self-raising flour
  'active', // active dry yeast
])

/**
 * Irregular plural → singular mappings for common culinary terms.
 * Checked before applying suffix rules.
 */
const IRREGULAR_PLURALS: Record<string, string> = {
  leaves: 'leaf',
  loaves: 'loaf',
  halves: 'half',
  knives: 'knife',
  shelves: 'shelf',
  calves: 'calf',
  wolves: 'wolf',
  lives: 'life',
  wives: 'wife',
  potatoes: 'potato',
  tomatoes: 'tomato',
  mangoes: 'mango',
  heroes: 'hero',
  echoes: 'echo',
  vetoes: 'veto',
}

/**
 * Words that look plural (-s ending) but are actually singular.
 * These should not have their trailing 's' stripped.
 */
const FALSE_PLURALS = new Set([
  'hummus',
  'couscous',
  'asparagus',
  'citrus',
  'hibiscus',
  'molasses',
  'anise',
  'tahini',
  'wasabi',
  'quinoa',
  'miso',
  'tempeh',
  'tofu',
  'lemongrass',
  'cress',
  'watercress',
  'harissa',
  'matzo',
  'dashi',
  'ghee',
  'paneer',
  'ricotta',
  'mascarpone',
  'swiss',
  'meringue',
  'mousse',
  'jus',
  'grits',
  'oats',
  'bitters',
  'capers',
  'chives',
  'chilis',
])

/**
 * Strip common plural suffixes to produce singular form.
 * Uses simple suffix rules tuned for culinary ingredient names.
 */
export function singularize(word: string): string {
  if (FALSE_PLURALS.has(word)) return word

  // Check irregular plurals first
  if (word in IRREGULAR_PLURALS) return IRREGULAR_PLURALS[word]!

  // -ies → -y (berries → berry, cherries → cherry)
  // But not single-syllable words ending in -ies (dies, ties, pies)
  if (word.endsWith('ies') && word.length > 4) {
    return word.slice(0, -3) + 'y'
  }

  // -ves → -f (loaves already handled by irregulars, but catch others)
  if (word.endsWith('ves') && word.length > 4) {
    return word.slice(0, -3) + 'f'
  }

  // -es after sibilants (sauces → sauce, peaches → peach)
  if (word.endsWith('ses') || word.endsWith('zes')) {
    return word.slice(0, -1)
  }
  if (word.endsWith('ches') || word.endsWith('shes') || word.endsWith('xes')) {
    return word.slice(0, -2)
  }

  // -oes → -o (potatoes already handled by irregulars, catch others)
  if (word.endsWith('oes') && word.length > 4) {
    return word.slice(0, -2)
  }

  // Generic -s removal (eggs → egg, carrots → carrot)
  // But not words ending in -ss (grass, bass) or -us (asparagus)
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && word.length > 2) {
    return word.slice(0, -1)
  }

  return word
}

/**
 * Strip cooking modifier words from the beginning of an ingredient name.
 * Only strips leading modifiers; preserves the core ingredient identity.
 *
 * Examples:
 *   "fresh chives" → "chives"
 *   "dried ground cumin" → "cumin"
 *   "boneless skinless chicken breast" → "chicken breast"
 *   "black pepper" → "black pepper" (black is an exception)
 */
export function stripModifiers(name: string): string {
  const words = name.split(/\s+/)

  // Find first non-modifier word
  let startIdx = 0
  for (let i = 0; i < words.length - 1; i++) {
    const word = words[i]!
    if (COOKING_MODIFIERS.has(word) && !MODIFIER_EXCEPTIONS.has(word)) {
      startIdx = i + 1
    } else {
      break
    }
  }

  if (startIdx === 0) return name
  return words.slice(startIdx).join(' ')
}

/**
 * Normalize an ingredient name for improved fuzzy matching.
 * Applies modifier stripping and singularization.
 *
 * Examples:
 *   "eggs" → "egg"
 *   "fresh chives" → "chive"  (but chives is in FALSE_PLURALS, so → "chives")
 *   "dried ground cumin" → "cumin"
 *   "black bread" → "black bread" (black is an exception)
 */
export function normalizeIngredientName(name: string): string {
  const lowered = name.toLowerCase().trim()

  // Step 1: Strip cooking modifiers
  const stripped = stripModifiers(lowered)

  // Step 2: Singularize each word
  const words = stripped.split(/\s+/)
  const singularized = words.map((w) => singularize(w))

  return singularized.join(' ')
}

/**
 * Extract the last word from a multi-word ingredient name.
 * Used as a final fallback for names like "black bread" → "bread".
 * Returns null if the name is a single word.
 */
export function extractLastWord(name: string): string | null {
  const words = name.trim().split(/\s+/)
  if (words.length <= 1) return null
  return words[words.length - 1]!
}
