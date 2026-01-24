/**
 * Ingredient alias table for ambiguous short terms.
 *
 * When AI extracts a short/ambiguous ingredient name, we expand it to
 * a sensible default before database search. This improves matching
 * accuracy for common terms like "pepper" → "black pepper".
 *
 * Rules:
 * - Keys should be lowercase
 * - Values should match ingredient names in the database
 * - Expand based on most common culinary usage
 */
export const INGREDIENT_ALIASES: Record<string, string> = {
  // Spices and seasonings
  pepper: 'black pepper',
  salt: 'salt', // Already specific, but including for completeness

  // Vegetables - default to most common variety
  onion: 'yellow onion',
  potato: 'russet potato',
  tomato: 'roma tomato',
  lettuce: 'romaine lettuce',
  mushroom: 'white mushroom',
  'bell pepper': 'green bell pepper',

  // Pantry staples
  flour: 'all-purpose flour',
  sugar: 'white sugar',
  rice: 'white rice',
  pasta: 'spaghetti',
  bread: 'white bread',

  // Dairy
  milk: 'whole milk',
  butter: 'unsalted butter',
  cream: 'heavy cream',
  cheese: 'cheddar cheese',
  yogurt: 'plain yogurt',

  // Oils and fats
  oil: 'vegetable oil',
  'cooking oil': 'vegetable oil',
  vinegar: 'white vinegar',

  // Proteins
  chicken: 'chicken breast',
  beef: 'ground beef',
  pork: 'pork loin',
  fish: 'salmon fillet',

  // Herbs - default to fresh unless specified
  basil: 'fresh basil',
  parsley: 'fresh parsley',
  cilantro: 'fresh cilantro',
  mint: 'fresh mint',
  dill: 'fresh dill',
  thyme: 'fresh thyme',
  rosemary: 'fresh rosemary',

  // Citrus
  lemon: 'lemon',
  lime: 'lime',
  orange: 'orange',

  // Nuts
  nuts: 'mixed nuts',
  almonds: 'almonds',
  walnuts: 'walnuts',

  // Legumes
  beans: 'black beans',
  lentils: 'green lentils',
}

/**
 * Apply ingredient alias expansion.
 *
 * @param name - The ingredient name extracted by AI
 * @returns The expanded name if an alias exists, otherwise the original name
 */
export function applyIngredientAlias(name: string): string {
  const normalized = name.toLowerCase().trim()
  return INGREDIENT_ALIASES[normalized] ?? name
}

/**
 * Check if a name is an ambiguous term that has an alias.
 *
 * @param name - The ingredient name to check
 * @returns True if the name has an alias expansion
 */
export function hasIngredientAlias(name: string): boolean {
  const normalized = name.toLowerCase().trim()
  return normalized in INGREDIENT_ALIASES
}
