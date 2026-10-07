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
  cream: 'double cream', // DB has double cream

  // Oils and fats - expand to DB names
  oil: 'vegetable oil', // DB has vegetable oil
  'cooking oil': 'vegetable oil', // DB has vegetable oil

  // Proteins - expand to specific cuts that exist in DB
  chicken: 'chicken breast', // DB has chicken breast
  beef: 'beef mince', // DB has beef mince
  pork: 'pork loin', // DB has pork loin
  fish: 'salmon fillet', // DB has salmon fillet

  // Legumes - expand to specific types that exist in DB
  beans: 'black beans', // DB has black beans
  lentils: 'green lentils', // DB has green lentils (in seed-expansion)

  // Baking - expand to DB names (seed-comprehensive)
  flour: 'plain flour', // DB has plain flour
  sugar: 'granulated sugar', // DB has granulated sugar
  yeast: 'active dry yeast', // DB has active dry yeast
  chocolate: 'chocolate chips', // DB has chocolate chips
  'ginger powder': 'ground ginger', // DB has ground ginger

  // Wines - expand to DB names (seed-comprehensive)
  wine: 'red wine', // DB has red wine
  sherry: 'dry sherry', // DB has dry sherry

  // Dairy alternatives
  yogurt: 'natural yogurt', // DB has natural yogurt
  yoghurt: 'natural yogurt', // British spelling (HON-1098)

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
  'self raising flour': 'self-raising flour', // Without hyphen
  mangetout: 'snap peas', // British term
  'coriander leaves': 'fresh coriander', // Explicit leaf reference
  prawn: 'prawns', // Singular form
  sultanas: 'raisins', // British term

  // Onion aliases
  'spring onions': 'spring onion', // Plural form

  // Alternate spellings
  'azuki beans': 'adzuki beans', // DB has adzuki beans
  'sichuan peppercorn': 'szechuan peppercorn', // DB has szechuan peppercorn

  // Chilli / pepper aliases
  'red pepper flakes': 'chilli flakes', // DB has chilli flakes
  'crushed red pepper': 'chilli flakes', // DB has chilli flakes
  'red chile pepper': 'red chilli', // DB has red chilli
  'green chile pepper': 'green chilli', // DB has green chilli
  'red chile': 'red chilli', // DB has red chilli
  'green chile': 'green chilli', // DB has green chilli

  // Tinned / processed tomato aliases
  'chopped tomatoes': 'tinned chopped tomatoes', // DB has tinned chopped tomatoes
  'diced tomatoes': 'tinned chopped tomatoes', // American word for chopped tomatoes
  'canned tomatoes': 'tinned chopped tomatoes', // DB has tinned chopped tomatoes

  // Meat / protein aliases
  mince: 'beef mince', // Most common "mince" meaning
  'minced beef': 'beef mince lean', // DB has beef mince lean
  'minced pork': 'pork mince', // DB has pork mince

  // Oil aliases
  'extra virgin olive oil': 'olive oil', // DB has olive oil

  // Juice-to-base aliases
  'lemon juice': 'lemon', // DB has lemon
  'lime juice': 'lime', // DB has lime
  'tomato juice': 'tomato', // DB has tomato

  // Cross-cuisine aliases (HON-411)
  'tamarind paste': 'tamarind puree', // DB has tamarind puree
  'bulgur wheat': 'bulgur', // DB has bulgur
  'crème fraîche': 'creme fraiche', // DB has creme fraiche
  'creme fraîche': 'creme fraiche', // Partial accent variant

  // Mexican ingredient aliases (HON-418)
  'chile guajillo': 'guajillo chilli', // DB has guajillo chilli
  'dried guajillo': 'guajillo chilli', // DB has guajillo chilli
  'chile pasilla': 'pasilla chilli', // DB has pasilla chilli
  'dried pasilla': 'pasilla chilli', // DB has pasilla chilli
  'chile de arbol': 'arbol chilli', // DB has arbol chilli
  'chile de árbol': 'arbol chilli', // DB has arbol chilli (with accent)
  'dried arbol': 'arbol chilli', // DB has arbol chilli
  'oaxaca cheese': 'queso oaxaca', // DB has queso oaxaca
  quesillo: 'queso oaxaca', // DB has queso oaxaca (common Mexican name)
  'corn truffle': 'huitlacoche', // DB has huitlacoche
  cuitlacoche: 'huitlacoche', // DB has huitlacoche (alternate spelling)
  'mexican raw sugar': 'piloncillo', // DB has piloncillo
  'panela sugar': 'piloncillo', // DB has piloncillo (Colombian name, same product)

  // Ethiopian ingredient aliases (HON-415)
  'berbere spice': 'berbere', // DB has berbere
  'berbere seasoning': 'berbere', // DB has berbere
  'ethiopian cardamom': 'korarima', // DB has korarima
  'ethiopian sacred basil': 'besobela', // DB has besobela
  'sacred basil': 'besobela', // DB has besobela (not Thai holy basil)
  'spiced butter': 'niter kibbeh', // DB has niter kibbeh
  'ethiopian spiced butter': 'niter kibbeh', // DB has niter kibbeh
  'kibbeh butter': 'niter kibbeh', // DB has niter kibbeh
  shiro: 'shiro powder', // DB has shiro powder
  'chickpea flour blend': 'shiro powder', // DB has shiro powder
  awaze: 'awaze paste', // DB has awaze paste
  'ethiopian chili paste': 'awaze paste', // DB has awaze paste

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

  // Mediterranean & French aliases (HON-417)
  'parmigiano-reggiano': 'parmesan', // DB has parmesan
  'parmigiano reggiano': 'parmesan', // DB has parmesan
  'phyllo pastry': 'filo pastry', // DB has filo pastry
  'filo dough': 'filo pastry', // DB has filo pastry
  filo: 'filo pastry', // DB has filo pastry
  'french green beans': 'haricots verts', // DB has haricots verts
  'calabrian chili paste': 'calabrian chilli', // DB has calabrian chilli
  'calabrian chili pepper': 'calabrian chilli', // DB has calabrian chilli
  'calabrian pepper': 'calabrian chilli', // DB has calabrian chilli
  sopressata: 'soppressata', // DB has soppressata (standard double-p spelling)
  'apple brandy': 'calvados', // DB has calvados
}

/**
 * Other English names for a global ingredient: the same thing under another
 * name, usually the American word for the pool's British name (HON-1100).
 *
 * Kept apart from `INGREDIENT_ALIASES` because the ingredient search shows a
 * synonym next to the row it found ("plain flour (all-purpose flour)"), and an
 * alias is an expansion to a more specific row, so "chicken breast (chicken)"
 * would be wrong there. The AI recipe matcher reads both tables.
 *
 * Lookups go through `synonymKey`, so a key also stands for its hyphen,
 * apostrophe and spacing variants ("all purpose flour", "half-and-half").
 *
 * Rules (checked by `pnpm db:validate`):
 * - Keys are lowercase and are not themselves the name of a global ingredient,
 *   not even after `synonymKey`, and no two keys share a `synonymKey`
 * - A key is in this table or in `INGREDIENT_ALIASES`, never both
 * - Values match a global ingredient name exactly
 */
export const INGREDIENT_SYNONYMS: Record<string, string> = {
  // Baking (pool names renamed from the American word, HON-1099)
  'all-purpose flour': 'plain flour',
  'whole wheat flour': 'wholemeal flour',
  'whole wheat pasta': 'wholewheat pasta',
  'powdered sugar': 'icing sugar',
  'confectioners sugar': 'icing sugar',
  'superfine sugar': 'caster sugar',
  cornstarch: 'cornflour',
  'corn starch': 'cornflour',
  'corn meal': 'cornmeal',
  'corn flakes': 'cornflakes',
  'baking soda': 'bicarbonate of soda',
  bicarb: 'bicarbonate of soda',
  'phyllo dough': 'filo pastry',
  phyllo: 'filo pastry',
  gelatin: 'gelatine',
  'vanilla bean': 'vanilla pod',
  'anise seed': 'aniseed',
  papadum: 'poppadom',

  // Dairy
  'half and half': 'single cream',
  'plain yogurt': 'natural yogurt',
  'natural yoghurt': 'natural yogurt',
  'greek yoghurt': 'greek yogurt',

  // Oils, seeds and legumes
  'canola oil': 'rapeseed oil',
  pepitas: 'pumpkin seeds',
  'fava beans': 'broad beans',
  'black-eyed peas': 'black-eyed beans',
  'cranberry beans': 'borlotti beans',
  'garbanzo beans': 'chickpeas',

  // Vegetables
  'cremini mushroom': 'chestnut mushroom',
  'napa cabbage': 'chinese leaf',
  rutabaga: 'swede',
  'roma tomato': 'plum tomato',
  sunchoke: 'jerusalem artichoke',
  'grape leaves': 'vine leaves',
  ramp: 'wild garlic',
  'red bell pepper': 'red pepper',
  'green bell pepper': 'green pepper',
  'yellow bell pepper': 'yellow pepper',
  capsicum: 'bell pepper',
  'sweet pepper': 'bell pepper',
  scallion: 'spring onion',
  'green onion': 'spring onion',

  // Meat and fish
  'cornish hen': 'poussin',
  'cornish game hen': 'poussin',
  'ham steak': 'gammon steak',
  'baby shrimp': 'small prawns',
  'cooked shrimp': 'cooked prawns',
  'shrimp peeled': 'peeled prawns',

  // Tins
  'canned anchovies': 'tinned anchovies',
  'canned mackerel': 'tinned mackerel',
  'canned salmon': 'tinned salmon',
  'canned sardines': 'tinned sardines',
  'canned pumpkin': 'tinned pumpkin',
  'canned diced tomatoes': 'tinned chopped tomatoes',
  'canned whole peeled tomatoes': 'tinned plum tomatoes',
  'canned green chiles': 'tinned green chillies',
  'coconut milk canned': 'tinned coconut milk',

  // Chilli spelling
  'chili oil': 'chilli oil',
  'chili garlic sauce': 'chilli garlic sauce',
  'sweet chili sauce': 'sweet chilli sauce',
  'thai chili': 'thai chilli',
  'ancho chili powder': 'ancho chilli powder',
  'kashmiri chili powder': 'kashmiri chilli powder',
  'arbol chili': 'arbol chilli',
  'calabrian chili': 'calabrian chilli',
  'guajillo chili': 'guajillo chilli',
  'pasilla chili': 'pasilla chilli',

  // Seeded rows renamed from the American word (HON-1083)
  'tomato sauce': 'passata',
  'tomato passata': 'passata',
  'ground beef': 'beef mince',
  'sour cream': 'soured cream',
  'pita bread': 'pitta bread',
  'chili flakes': 'chilli flakes',
  zucchini: 'courgette',
  'bok choy': 'pak choi',
  corn: 'sweetcorn',
  eggplant: 'aubergine',
  arugula: 'rocket',
  'chili powder': 'chilli powder',
  'lasagna sheets': 'lasagne sheets',
  'navy beans': 'haricot beans',
  'canned tuna': 'tinned tuna',
  'goat cheese': "goat's cheese",

  // American rows merged into their British twin (HON-1097)
  shrimp: 'prawns',
  'pork tenderloin': 'pork fillet',
  'heavy cream': 'double cream',
  'ground lamb': 'lamb mince',
  'ground pork': 'pork mince',
  'ground turkey': 'turkey mince',
  'ground chicken': 'chicken mince',
  cilantro: 'fresh coriander',
  'fresh cilantro': 'fresh coriander',
  beet: 'beetroot',
  'lima beans': 'butter beans',
  'chicken broth': 'chicken stock',
  'beef broth': 'beef stock',
  'vegetable broth': 'vegetable stock',
  'green chili pepper': 'green chilli',
  'red chili pepper': 'red chilli',
  'beef stew meat': 'stewing beef',
}

/**
 * The lookup key for `INGREDIENT_SYNONYMS`: lower case, apostrophes dropped,
 * hyphens read as spaces, runs of spaces collapsed. A trigram search ignores
 * those marks, so "all purpose flour" used to find the "all-purpose flour" row
 * by name. Now that the American word lives only in the synonym table, the
 * lookup has to ignore them too (HON-1099).
 */
export function synonymKey(name: string): string {
  return name.toLowerCase().replace(/['’]/g, '').replace(/[-‐–]/g, ' ').replace(/\s+/g, ' ').trim()
}

const SYNONYMS_BY_KEY = new Map(
  Object.entries(INGREDIENT_SYNONYMS).map(([key, poolName]) => [synonymKey(key), poolName]),
)

/** The pool name for another English name of a global ingredient, if it is one. */
export function findSynonym(name: string): string | undefined {
  return SYNONYMS_BY_KEY.get(synonymKey(name))
}

/**
 * Apply ingredient alias expansion, or resolve another English name to the
 * pool's name.
 *
 * @param name - The ingredient name extracted by AI
 * @returns The expanded or pool name if the name is in either table, otherwise the original name
 */
export function applyIngredientAlias(name: string): string {
  const normalized = name.toLowerCase().trim()
  return INGREDIENT_ALIASES[normalized] ?? findSynonym(name) ?? name
}

/**
 * Check if a name is an ambiguous term that has an alias, or another English
 * name for a pool ingredient.
 *
 * @param name - The ingredient name to check
 * @returns True if `applyIngredientAlias` would change the name
 */
export function hasIngredientAlias(name: string): boolean {
  const normalized = name.toLowerCase().trim()
  return normalized in INGREDIENT_ALIASES || findSynonym(name) !== undefined
}
