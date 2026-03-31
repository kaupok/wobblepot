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
  'ginger powder': 'ground ginger', // DB has ground ginger

  // Wines - expand to DB names (seed-comprehensive)
  wine: 'red wine', // DB has red wine
  sherry: 'dry sherry', // DB has dry sherry

  // Dairy alternatives
  yogurt: 'plain yogurt', // DB has plain yogurt

  // Indian ingredients - expand to DB names (seed-comprehensive)
  besan: 'chickpea flour', // DB has chickpea flour
  'gram flour': 'chickpea flour', // DB has chickpea flour
  'atta flour': 'chapati flour', // DB has chapati flour
  atta: 'chapati flour', // DB has chapati flour
  tamarind: 'tamarind puree', // DB has tamarind puree
  'carom seeds': 'ajwain seeds', // DB has ajwain seeds
  'dried fenugreek leaves': 'kasuri methi', // DB has kasuri methi
  'methi leaves': 'kasuri methi', // DB has kasuri methi
  achar: 'Indian pickle', // DB has Indian pickle

  // Condiments - expand to DB names
  mustard: 'yellow mustard', // DB has yellow mustard
  'soy sauce': 'light soy sauce', // DB has light soy sauce
  'vietnamese fish sauce': 'fish sauce', // DB has fish sauce
  miso: 'white miso paste', // DB has white miso paste
  vinegar: 'white vinegar', // DB has white vinegar

  // British English / alternate names (seed-import-coverage)
  cornmeal: 'corn meal', // DB has corn meal
  'plain flour': 'all-purpose flour', // British term
  'self raising flour': 'self-raising flour', // Without hyphen
  aubergine: 'eggplant', // British term
  courgette: 'zucchini', // British term
  rocket: 'arugula', // British term
  mangetout: 'snap peas', // British term
  'coriander leaves': 'cilantro', // Explicit leaf reference
  'fresh coriander': 'cilantro', // Common British recipe phrasing
  prawn: 'prawns', // Singular form
  capsicum: 'bell pepper', // Australian/British term
  swede: 'rutabaga', // British term
  sultanas: 'raisins', // British term
  'bicarbonate of soda': 'baking soda', // British term
  'icing sugar': 'powdered sugar', // British term

  // Onion / scallion aliases
  scallion: 'spring onion', // DB has spring onion
  'green onion': 'spring onion', // DB has spring onion
  'spring onions': 'spring onion', // Plural form

  // Alternate spellings
  'azuki beans': 'adzuki beans', // DB has adzuki beans
  'sichuan peppercorn': 'szechuan peppercorn', // DB has szechuan peppercorn

  // Chilli / pepper aliases
  'red pepper flakes': 'chili flakes', // DB has chili flakes
  'crushed red pepper': 'chili flakes', // DB has chili flakes
  'red chile pepper': 'red chilli', // DB has red chilli
  'green chile pepper': 'green chilli', // DB has green chilli
  'red chile': 'red chilli', // DB has red chilli
  'green chile': 'green chilli', // DB has green chilli

  // Canned / processed tomato aliases
  'chopped tomatoes': 'canned diced tomatoes', // DB has canned diced tomatoes
  passata: 'tomato puree', // DB has tomato puree
  'tomato passata': 'tomato puree', // DB has tomato puree

  // Meat / protein aliases
  mince: 'ground beef', // Most common "mince" meaning
  'minced beef': 'beef mince lean', // DB has beef mince lean
  'minced pork': 'ground pork', // DB has ground pork
  // stewing beef / beef stew meat: now direct ingredients in seed-import-coverage.ts

  // Oil aliases
  'rapeseed oil': 'canola oil', // DB has canola oil (seed-import-coverage)
  'extra virgin olive oil': 'olive oil', // DB has olive oil

  // Juice-to-base aliases
  'lemon juice': 'lemon', // DB has lemon
  'lime juice': 'lime', // DB has lime
  'tomato juice': 'tomato', // DB has tomato

  // Dairy aliases
  'natural yogurt': 'plain yogurt', // British term

  // Cross-cuisine aliases (HON-411)
  'tamarind paste': 'tamarind puree', // DB has tamarind puree
  'bulgur wheat': 'bulgur', // DB has bulgur
  'crème fraîche': 'creme fraiche', // DB has creme fraiche
  'creme fraîche': 'creme fraiche', // Partial accent variant

  // Mexican ingredient aliases (HON-418)
  'chile guajillo': 'guajillo chili', // DB has guajillo chili
  'dried guajillo': 'guajillo chili', // DB has guajillo chili
  'chile pasilla': 'pasilla chili', // DB has pasilla chili
  'dried pasilla': 'pasilla chili', // DB has pasilla chili
  'chile de arbol': 'arbol chili', // DB has arbol chili
  'chile de árbol': 'arbol chili', // DB has arbol chili (with accent)
  'dried arbol': 'arbol chili', // DB has arbol chili
  'oaxaca cheese': 'queso oaxaca', // DB has queso oaxaca
  quesillo: 'queso oaxaca', // DB has queso oaxaca (common Mexican name)
  'corn truffle': 'huitlacoche', // DB has huitlacoche
  cuitlacoche: 'huitlacoche', // DB has huitlacoche (alternate spelling)
  'mexican raw sugar': 'piloncillo', // DB has piloncillo
  'panela sugar': 'piloncillo', // DB has piloncillo (Colombian name, same product)

  // Korean ingredient aliases (HON-413)
  'korean red pepper paste': 'gochujang', // DB has gochujang
  // 'red pepper paste' intentionally omitted — too generic (could be harissa, gochujang, etc.)
  'korean fermented soybean paste': 'doenjang', // DB has doenjang
  'korean rice cakes': 'tteok', // DB has tteok
  'rice cakes': 'tteok', // DB has tteok
  // 'roasted seaweed' intentionally omitted — nori already in DB as the more common match
  'korean seaweed': 'gim', // DB has gim
  'korean kelp': 'dashima', // DB has dashima

  // Japanese pantry aliases (HON-412)
  'dashi stock': 'dashi', // DB has dashi
  'dashi broth': 'dashi', // DB has dashi
  wasabi: 'wasabi paste', // DB has wasabi paste
  tsuyu: 'mentsuyu', // DB has mentsuyu
  'soybean flour': 'kinako', // DB has kinako
  'curry roux': 'Japanese curry roux', // DB has Japanese curry roux

  // British / Nordic aliases (HON-421)
  'cured salmon': 'gravlax', // DB has gravlax
  'black treacle': 'treacle', // DB has treacle
  'yeast extract': 'marmite', // DB has marmite

  // Caribbean & Brazilian aliases (HON-420)
  'dendê oil': 'palm oil', // DB has palm oil — dendê is unrefined palm oil variant
  'dende oil': 'palm oil', // Without accent
  'brazilian nut': 'brazil nuts', // DB has brazil nuts
  recao: 'culantro', // DB has culantro — Puerto Rican name for culantro
  'dried beef': 'carne seca', // DB has carne seca
  'brazilian cream cheese': 'requeijão', // DB has requeijão

  // West African aliases (HON-416)
  iru: 'dawadawa', // Yoruba name for fermented locust bean
  'locust bean condiment': 'dawadawa', // DB has dawadawa
  'yaji spice': 'suya spice', // DB has suya spice
  yaji: 'suya spice', // DB has suya spice
  'cassava couscous': 'attieke', // DB has attieke
  attiéké: 'attieke', // Accented spelling
  'african basil': 'scent leaf', // DB has scent leaf
  'dika seeds': 'ogbono seeds', // Alternate name for ogbono
  'melon seeds': 'egusi seeds', // DB has egusi seeds
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
