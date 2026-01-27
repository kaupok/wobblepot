/**
 * Ingredient alias table for ambiguous short terms.
 *
 * When AI extracts a short/ambiguous ingredient name, we expand it to
 * a sensible default before database search. This improves matching
 * accuracy for common terms like "pepper" → "black pepper".
 *
 * IMPORTANT: All alias targets MUST exist in the database (prisma/seed.ts,
 * prisma/seed-expansion.ts, or prisma/seed-comprehensive.ts).
 * Run `pnpm db:validate` to verify.
 *
 * Rules:
 * - Keys should be lowercase
 * - Values MUST match ingredient names in the database exactly
 * - Expand based on most common culinary usage
 * - Only add aliases when the target is MORE specific than the key
 */
export const INGREDIENT_ALIASES: Record<string, string> = {
  // Spices and seasonings - "pepper" alone usually means black pepper
  pepper: 'black pepper',

  // Vegetables - only expand when target exists in DB
  lettuce: 'romaine lettuce', // DB has romaine lettuce

  // Pantry staples - expand to DB names
  rice: 'white rice', // DB has white rice
  pasta: 'spaghetti', // DB has spaghetti

  // Dairy - expand to specific variants that exist in DB
  cream: 'heavy cream', // DB has heavy cream

  // Oils and fats - expand to DB names
  oil: 'vegetable oil', // DB has vegetable oil
  'cooking oil': 'vegetable oil', // DB has vegetable oil

  // Proteins - expand to specific cuts that exist in DB
  chicken: 'chicken breast', // DB has chicken breast
  beef: 'ground beef', // DB has ground beef
  pork: 'pork loin', // DB has pork loin
  fish: 'salmon fillet', // DB has salmon fillet

  // Legumes - expand to specific types that exist in DB
  beans: 'black beans', // DB has black beans
  lentils: 'green lentils', // DB has green lentils (in seed-expansion)

  // Baking - expand to DB names (seed-comprehensive)
  flour: 'all-purpose flour', // DB has all-purpose flour
  sugar: 'granulated sugar', // DB has granulated sugar
  yeast: 'active dry yeast', // DB has active dry yeast
  chocolate: 'chocolate chips', // DB has chocolate chips

  // Wines - expand to DB names (seed-comprehensive)
  wine: 'red wine', // DB has red wine
  sherry: 'dry sherry', // DB has dry sherry

  // Dairy alternatives
  yogurt: 'plain yogurt', // DB has plain yogurt

  // Condiments - expand to DB names
  mustard: 'yellow mustard', // DB has yellow mustard
  'soy sauce': 'light soy sauce', // DB has light soy sauce
  miso: 'white miso paste', // DB has white miso paste
  vinegar: 'white vinegar', // DB has white vinegar
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
