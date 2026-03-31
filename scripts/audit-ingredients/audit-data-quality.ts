/**
 * Ingredient Data Quality Audit
 *
 * Checks all ingredients in the database for:
 * - Nutritional data quality (missing values, calorie/macro consistency, outliers)
 * - Allergen correctness (missing tags, false positives)
 * - Alias validity (broken targets, missing aliases)
 * - Duplicate names across seed files
 *
 * Usage: npx tsx scripts/audit-ingredients/audit-data-quality.ts [--focus nutrition|allergens|aliases|all]
 * Output: JSON report to stdout
 */

import 'dotenv/config'
import { prisma } from '../../src/lib/prisma'
import { INGREDIENT_ALIASES } from '../../src/lib/ingredient-aliases'

// ============================================
// TYPES
// ============================================

interface Finding {
  severity: 'critical' | 'warning' | 'info'
  area: 'nutrition' | 'allergen' | 'alias' | 'duplicate'
  ingredient: string
  issue: string
  details: Record<string, unknown>
}

interface AuditReport {
  timestamp: string
  totalIngredients: number
  findings: Finding[]
  summary: {
    critical: number
    warning: number
    info: number
    byArea: Record<string, number>
  }
}

// ============================================
// ALLERGEN HEURISTICS
// ============================================

const DAIRY_KEYWORDS = [
  'milk',
  'cream',
  'cheese',
  'yogurt',
  'yoghurt',
  'butter',
  'ghee',
  'whey',
  'casein',
  'ricotta',
  'mascarpone',
  'mozzarella',
  'parmesan',
  'cheddar',
  'brie',
  'camembert',
  'gouda',
  'gruyère',
  'gruyere',
  'feta',
  'halloumi',
  'paneer',
  'quark',
  'labneh',
  'burrata',
  'provolone',
  'fontina',
  'havarti',
  'emmental',
  'manchego',
  'pecorino',
  'gorgonzola',
  'roquefort',
  'stilton',
  'boursin',
  'raclette',
  'colby',
  'edam',
  'asiago',
  'jarlsberg',
  'taleggio',
  'chèvre',
]
const DAIRY_EXCEPTIONS = [
  'coconut milk',
  'coconut cream',
  'almond milk',
  'oat milk',
  'soy milk',
  'rice milk',
  'cashew milk',
  'coconut yogurt',
  'peanut butter',
  'almond butter',
  'cashew butter',
  'cocoa butter',
  'shea butter',
  'nut butter',
  'sunflower butter',
  'seed butter',
]

const FISH_KEYWORDS = [
  'salmon',
  'tuna',
  'cod',
  'trout',
  'mackerel',
  'anchovy',
  'anchovies',
  'sardine',
  'haddock',
  'halibut',
  'sea bass',
  'tilapia',
  'swordfish',
  'snapper',
  'catfish',
  'perch',
  'monkfish',
  'pike',
  'grouper',
  'mahi mahi',
  'pollock',
  'plaice',
  'herring',
  'whiting',
  'sea bream',
  'flounder',
  'barramundi',
  'arctic char',
  'pangasius',
  'sole',
  'gravlax',
  'fish fillet',
  'white fish',
  'fish paste',
  'fish sauce',
  'dashi',
  'Worcestershire sauce',
  'worcestershire',
  'anchovy paste',
]
const FISH_SUBCATEGORIES = ['fish']

const SHELLFISH_KEYWORDS = [
  'shrimp',
  'prawn',
  'crab',
  'lobster',
  'mussel',
  'clam',
  'oyster',
  'scallop',
  'calamari',
  'squid',
  'octopus',
  'shrimp paste',
  'oyster sauce',
]
const SHELLFISH_SUBCATEGORIES = ['shellfish']

const NUT_KEYWORDS = [
  'almond',
  'walnut',
  'cashew',
  'pecan',
  'hazelnut',
  'pistachio',
  'macadamia',
  'brazil nut',
  'pine nut',
  'chestnut',
]
const NUT_EXCEPTIONS = ['coconut', 'peanut', 'nutmeg', 'butternut']

const PEANUT_KEYWORDS = ['peanut']

const SOY_KEYWORDS = ['soy', 'tofu', 'tempeh', 'edamame', 'miso', 'doenjang', 'soy sauce']

const SESAME_KEYWORDS = ['sesame', 'tahini']

const EGG_KEYWORDS = ['egg']
const EGG_EXCEPTIONS = ['eggplant', 'aubergine']
const EGG_PASTAS = ['tagliatelle', 'pappardelle', 'egg noodle']

const GLUTEN_KEYWORDS = [
  'wheat',
  'bread',
  'pasta',
  'spaghetti',
  'penne',
  'rigatoni',
  'linguine',
  'farfalle',
  'fusilli',
  'bucatini',
  'orecchiette',
  'paccheri',
  'macaroni',
  'lasagne',
  'tortellini',
  'gnocchi',
  'orzo',
  'couscous',
  'bulgur',
  'farro',
  'barley',
  'pearl barley',
  'rye',
  'seitan',
  'udon',
  'soba',
  'ramen',
  'semolina',
  'freekeh',
]
const GLUTEN_FLOUR_KEYWORDS = ['flour']
const GLUTEN_FLOUR_EXCEPTIONS = [
  'almond flour',
  'coconut flour',
  'rice flour',
  'chickpea flour',
  'tapioca flour',
  'corn flour',
  'oat flour',
  'buckwheat flour',
]
const GLUTEN_EXCEPTIONS = [
  'rice noodle',
  'glass noodle',
  'buckwheat',
  'rice',
  'corn',
  'polenta',
  'millet',
  'quinoa',
  'breadfruit',
]

// ============================================
// CATEGORY GUARD
// ============================================

// For name-based allergen checks, only run if the ingredient's category
// could legitimately contain the allergen. A vegetable named "water chestnut"
// can never be a tree nut; a spice named "cream of tartar" is never dairy.
//
// Category/subcategory-based checks (e.g., category === 'dairy') are unaffected —
// they're high-confidence and run always. This guard only limits keyword searches.
const NAME_CHECK_ALLOWED_CATEGORIES: Record<string, Set<string>> = {
  dairy: new Set(['dairy', 'fat', 'condiment']),
  fish: new Set(['protein', 'condiment']),
  shellfish: new Set(['protein', 'condiment']),
  nuts: new Set(['fat', 'condiment']),
  peanuts: new Set(['fat', 'legume', 'condiment']),
  soy: new Set(['protein', 'legume', 'condiment']),
  sesame: new Set(['fat', 'condiment', 'spice']),
  eggs: new Set(['protein', 'carb']),
  gluten: new Set(['carb', 'condiment']),
}

/** Check if name-based allergen detection should run for this category */
function shouldCheckNameFor(allergen: string, category: string): boolean {
  const allowed = NAME_CHECK_ALLOWED_CATEGORIES[allergen]
  return allowed ? allowed.has(category) : true
}

// ============================================
// AUDIT FUNCTIONS
// ============================================

function auditNutrition(
  ingredient: {
    name: string
    category: string
    subcategory: string | null
    calories: number
    protein: number
    carbs: number
    fat: number
    fiber: number | null
    defaultUnit: string
    gramsPerPiece: number | null
    densityGPerMl: number | null
  },
  findings: Finding[],
) {
  const { name, category, calories, protein, carbs, fat } = ingredient

  // All-zero check
  if (calories === 0 && protein === 0 && carbs === 0 && fat === 0) {
    // Some items legitimately have near-zero nutrition (water, some extracts)
    const allowedZeros = [
      'water',
      'ice',
      'pandan extract',
      'rose water',
      'orange blossom water',
      'kaffir lime leaves',
    ]
    if (!allowedZeros.some((z) => name.includes(z))) {
      findings.push({
        severity: 'critical',
        area: 'nutrition',
        ingredient: name,
        issue: 'All nutritional values are zero — likely placeholder data',
        details: { calories, protein, carbs, fat },
      })
    }
  }

  // Protein item with 0 protein
  if (category === 'protein' && protein === 0) {
    findings.push({
      severity: 'critical',
      area: 'nutrition',
      ingredient: name,
      issue: 'Protein category item has 0g protein',
      details: { category, protein },
    })
  }

  // Fat item with 0 fat
  if (category === 'fat' && fat === 0) {
    findings.push({
      severity: 'critical',
      area: 'nutrition',
      ingredient: name,
      issue: 'Fat category item has 0g fat',
      details: { category, fat },
    })
  }

  // Calorie-macro consistency
  // Fiber provides ~2 cal/g (not 4), so subtract it from carbs when available
  const fiber = ingredient.fiber ?? 0
  const digestibleCarbs = Math.max(0, carbs - fiber)
  const expectedCalories = protein * 4 + digestibleCarbs * 4 + fiber * 2 + fat * 9
  // Only check if both values are meaningful (> 20 kcal avoids noise on trace items)
  if (expectedCalories > 20 && calories > 20) {
    const deviation = Math.abs(calories - expectedCalories) / expectedCalories
    if (deviation > 0.5) {
      findings.push({
        severity: 'warning',
        area: 'nutrition',
        ingredient: name,
        issue: `Calorie-macro mismatch: declared ${calories} kcal, expected ~${Math.round(expectedCalories)} kcal (${Math.round(deviation * 100)}% off)`,
        details: {
          declared: calories,
          expected: Math.round(expectedCalories),
          deviation: `${Math.round(deviation * 100)}%`,
          protein,
          carbs,
          fat,
          fiber,
        },
      })
    } else if (deviation > 0.2) {
      findings.push({
        severity: 'info',
        area: 'nutrition',
        ingredient: name,
        issue: `Calorie-macro mismatch: declared ${calories} kcal, expected ~${Math.round(expectedCalories)} kcal (${Math.round(deviation * 100)}% off)`,
        details: {
          declared: calories,
          expected: Math.round(expectedCalories),
          deviation: `${Math.round(deviation * 100)}%`,
        },
      })
    }
  }

  // Macros exceeding 100g per 100g
  const totalMacros = protein + carbs + fat
  if (totalMacros > 105) {
    findings.push({
      severity: 'warning',
      area: 'nutrition',
      ingredient: name,
      issue: `Macros sum to ${totalMacros}g per 100g (protein + carbs + fat should not exceed ~100g)`,
      details: { protein, carbs, fat, total: totalMacros },
    })
  }

  // Negative values
  for (const [field, value] of Object.entries({
    calories,
    protein,
    carbs,
    fat,
  })) {
    if (value < 0) {
      findings.push({
        severity: 'critical',
        area: 'nutrition',
        ingredient: name,
        issue: `Negative ${field} value: ${value}`,
        details: { [field]: value },
      })
    }
  }

  // Category-specific outliers
  if (category === 'vegetable' && calories > 200) {
    findings.push({
      severity: 'info',
      area: 'nutrition',
      ingredient: name,
      issue: `Vegetable with ${calories} kcal/100g — unusually high`,
      details: { category, calories },
    })
  }
  if (category === 'fruit' && calories > 150) {
    findings.push({
      severity: 'info',
      area: 'nutrition',
      ingredient: name,
      issue: `Fruit with ${calories} kcal/100g — unusually high`,
      details: { category, calories },
    })
  }

  // Missing unit data
  if (ingredient.defaultUnit === 'piece' && ingredient.gramsPerPiece === null) {
    findings.push({
      severity: 'warning',
      area: 'nutrition',
      ingredient: name,
      issue: 'Piece-based item missing gramsPerPiece — quantity conversion will use default 30g',
      details: { defaultUnit: 'piece', gramsPerPiece: null },
    })
  }

  // Liquid items missing densityGPerMl (needed for ml→g UI display)
  const liquidSubcategories = ['liquid', 'sauce', 'oil', 'vinegar', 'cooking fat']
  const liquidNameHints = [
    'milk',
    'cream',
    'oil',
    'vinegar',
    'sauce',
    'juice',
    'wine',
    'stock',
    'broth',
    'water',
    'mirin',
    'dashi',
    'ponzu',
  ]
  const isLiquid =
    liquidSubcategories.includes(ingredient.subcategory ?? '') ||
    liquidNameHints.some((h) => name.includes(h))
  if (isLiquid && ingredient.densityGPerMl === null) {
    findings.push({
      severity: 'info',
      area: 'nutrition',
      ingredient: name,
      issue: 'Liquid item missing densityGPerMl — needed for ml↔g display conversion',
      details: { subcategory: ingredient.subcategory, densityGPerMl: null },
    })
  }
}

function auditAllergens(
  ingredient: {
    name: string
    category: string
    subcategory: string | null
    proteinType: string | null
    allergens: string[]
  },
  findings: Finding[],
) {
  const { name, category, subcategory, proteinType, allergens } = ingredient
  const lowerName = name.toLowerCase()

  // Helper: check if allergen is present
  const has = (allergen: string) => allergens.includes(allergen)

  // Helper: check if name matches keywords (but not exceptions)
  const nameMatches = (keywords: string[], exceptions: string[] = []) => {
    if (exceptions.some((e) => lowerName.includes(e.toLowerCase()))) return false
    return keywords.some((k) => lowerName.includes(k.toLowerCase()))
  }

  // DAIRY
  if (
    (category === 'dairy' ||
      (shouldCheckNameFor('dairy', category) && nameMatches(DAIRY_KEYWORDS, DAIRY_EXCEPTIONS))) &&
    !has('dairy') &&
    !DAIRY_EXCEPTIONS.some((e) => lowerName.includes(e.toLowerCase()))
  ) {
    findings.push({
      severity: 'critical',
      area: 'allergen',
      ingredient: name,
      issue: `Dairy item missing 'dairy' allergen tag`,
      details: { category, currentAllergens: allergens, reason: 'category or name match' },
    })
  }

  // FISH
  if (
    (FISH_SUBCATEGORIES.includes(subcategory ?? '') ||
      (proteinType === 'fish' && subcategory === 'fish') ||
      (shouldCheckNameFor('fish', category) && nameMatches(FISH_KEYWORDS))) &&
    !has('fish')
  ) {
    // Don't flag shellfish items
    if (!SHELLFISH_SUBCATEGORIES.includes(subcategory ?? '') && !nameMatches(SHELLFISH_KEYWORDS)) {
      findings.push({
        severity: 'critical',
        area: 'allergen',
        ingredient: name,
        issue: `Fish item missing 'fish' allergen tag`,
        details: { subcategory, proteinType, currentAllergens: allergens },
      })
    }
  }

  // SHELLFISH
  if (
    (SHELLFISH_SUBCATEGORIES.includes(subcategory ?? '') ||
      (shouldCheckNameFor('shellfish', category) && nameMatches(SHELLFISH_KEYWORDS))) &&
    !has('shellfish')
  ) {
    findings.push({
      severity: 'critical',
      area: 'allergen',
      ingredient: name,
      issue: `Shellfish item missing 'shellfish' allergen tag`,
      details: { subcategory, currentAllergens: allergens },
    })
  }

  // NUTS
  if (
    shouldCheckNameFor('nuts', category) &&
    nameMatches(NUT_KEYWORDS, NUT_EXCEPTIONS) &&
    !has('nuts')
  ) {
    findings.push({
      severity: 'critical',
      area: 'allergen',
      ingredient: name,
      issue: `Tree nut item missing 'nuts' allergen tag`,
      details: { currentAllergens: allergens },
    })
  }
  if (subcategory === 'nut' && !has('nuts')) {
    // Check it's not coconut or peanut
    if (!NUT_EXCEPTIONS.some((e) => lowerName.includes(e))) {
      findings.push({
        severity: 'critical',
        area: 'allergen',
        ingredient: name,
        issue: `Nut subcategory item missing 'nuts' allergen tag`,
        details: { subcategory, currentAllergens: allergens },
      })
    }
  }

  // PEANUTS
  if (shouldCheckNameFor('peanuts', category) && nameMatches(PEANUT_KEYWORDS) && !has('peanuts')) {
    findings.push({
      severity: 'critical',
      area: 'allergen',
      ingredient: name,
      issue: `Peanut item missing 'peanuts' allergen tag`,
      details: { currentAllergens: allergens },
    })
  }

  // SOY
  if (shouldCheckNameFor('soy', category) && nameMatches(SOY_KEYWORDS) && !has('soy')) {
    findings.push({
      severity: 'warning',
      area: 'allergen',
      ingredient: name,
      issue: `Soy-based item missing 'soy' allergen tag`,
      details: { currentAllergens: allergens },
    })
  }

  // SESAME
  if (shouldCheckNameFor('sesame', category) && nameMatches(SESAME_KEYWORDS) && !has('sesame')) {
    findings.push({
      severity: 'warning',
      area: 'allergen',
      ingredient: name,
      issue: `Sesame-based item missing 'sesame' allergen tag`,
      details: { currentAllergens: allergens },
    })
  }

  // EGGS
  if (
    ((shouldCheckNameFor('eggs', category) && nameMatches(EGG_KEYWORDS, EGG_EXCEPTIONS)) ||
      proteinType === 'eggs') &&
    !has('eggs')
  ) {
    findings.push({
      severity: 'critical',
      area: 'allergen',
      ingredient: name,
      issue: `Egg item missing 'eggs' allergen tag`,
      details: { proteinType, currentAllergens: allergens },
    })
  }
  // Egg pastas
  if (EGG_PASTAS.some((p) => lowerName.includes(p)) && !has('eggs')) {
    findings.push({
      severity: 'warning',
      area: 'allergen',
      ingredient: name,
      issue: `Egg-based pasta missing 'eggs' allergen tag`,
      details: { currentAllergens: allergens },
    })
  }

  // GLUTEN
  const isGlutenFree = GLUTEN_EXCEPTIONS.some((e) => lowerName.includes(e.toLowerCase()))
  if (!isGlutenFree && shouldCheckNameFor('gluten', category)) {
    const isGlutenGrain = nameMatches(GLUTEN_KEYWORDS)
    const isGlutenFlour =
      nameMatches(GLUTEN_FLOUR_KEYWORDS) &&
      !GLUTEN_FLOUR_EXCEPTIONS.some((e) => lowerName.includes(e.toLowerCase()))
    if ((isGlutenGrain || isGlutenFlour) && !has('gluten')) {
      findings.push({
        severity: 'warning',
        area: 'allergen',
        ingredient: name,
        issue: `Gluten-containing item missing 'gluten' allergen tag`,
        details: { currentAllergens: allergens },
      })
    }
  }

  // FALSE POSITIVES — check for allergens that shouldn't be there
  if (has('dairy') && DAIRY_EXCEPTIONS.some((e) => lowerName.includes(e.toLowerCase()))) {
    findings.push({
      severity: 'warning',
      area: 'allergen',
      ingredient: name,
      issue: `Plant-based item has 'dairy' allergen tag — likely false positive`,
      details: { currentAllergens: allergens },
    })
  }
  if (has('gluten') && GLUTEN_EXCEPTIONS.some((e) => lowerName.includes(e.toLowerCase()))) {
    findings.push({
      severity: 'warning',
      area: 'allergen',
      ingredient: name,
      issue: `Gluten-free item has 'gluten' allergen tag — likely false positive`,
      details: { currentAllergens: allergens },
    })
  }
  if (has('nuts') && NUT_EXCEPTIONS.some((e) => lowerName.includes(e))) {
    findings.push({
      severity: 'info',
      area: 'allergen',
      ingredient: name,
      issue: `Item has 'nuts' tag but name suggests it may not be a tree nut`,
      details: { currentAllergens: allergens },
    })
  }
}

function auditAliases(allIngredientNames: Set<string>, findings: Finding[]) {
  // Check all alias targets exist
  for (const [alias, target] of Object.entries(INGREDIENT_ALIASES)) {
    if (!allIngredientNames.has(target.toLowerCase())) {
      findings.push({
        severity: 'warning',
        area: 'alias',
        ingredient: alias,
        issue: `Alias "${alias}" → "${target}" points to non-existent ingredient`,
        details: { alias, target },
      })
    }
  }

  // Check for ingredients that probably need aliases but don't have them
  // Common patterns: regional variants, abbreviations, generic terms
  const suggestedAliases: Array<{ from: string; to: string; reason: string }> = []

  for (const name of allIngredientNames) {
    // Items with "fresh" or "dried" prefix might need a base alias
    if (name.startsWith('fresh ')) {
      const base = name.replace('fresh ', '')
      if (!allIngredientNames.has(base) && !(base in INGREDIENT_ALIASES)) {
        // Only suggest if there's no other form
        const hasDried = allIngredientNames.has(`dried ${base}`)
        if (!hasDried) {
          suggestedAliases.push({
            from: base,
            to: name,
            reason: `"${name}" exists but bare "${base}" has no alias`,
          })
        }
      }
    }
  }

  if (suggestedAliases.length > 0) {
    findings.push({
      severity: 'info',
      area: 'alias',
      ingredient: '(multiple)',
      issue: `${suggestedAliases.length} potential missing aliases detected`,
      details: { suggestions: suggestedAliases },
    })
  }
}

function auditDuplicates(ingredients: Array<{ name: string }>, findings: Finding[]) {
  const seen = new Map<string, number>()
  for (const { name } of ingredients) {
    const lower = name.toLowerCase()
    seen.set(lower, (seen.get(lower) ?? 0) + 1)
  }
  for (const [name, count] of seen) {
    if (count > 1) {
      findings.push({
        severity: 'warning',
        area: 'duplicate',
        ingredient: name,
        issue: `Ingredient name appears ${count} times in the database`,
        details: { count },
      })
    }
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  const focusArg = process.argv.find((a) => a.startsWith('--focus='))
  const focus = focusArg?.split('=')[1] ?? 'all'

  const ingredients = await prisma.ingredient.findMany({
    select: {
      name: true,
      category: true,
      subcategory: true,
      proteinType: true,
      defaultUnit: true,
      allergens: true,
      calories: true,
      protein: true,
      carbs: true,
      fat: true,
      fiber: true,
      gramsPerPiece: true,
      densityGPerMl: true,
    },
    orderBy: { name: 'asc' },
  })

  const findings: Finding[] = []
  const allNames = new Set(ingredients.map((i) => i.name.toLowerCase()))

  if (focus === 'all' || focus === 'nutrition') {
    for (const ingredient of ingredients) {
      auditNutrition(ingredient, findings)
    }
  }

  if (focus === 'all' || focus === 'allergens') {
    for (const ingredient of ingredients) {
      auditAllergens(
        {
          ...ingredient,
          allergens: ingredient.allergens as string[],
        },
        findings,
      )
    }
  }

  if (focus === 'all' || focus === 'aliases') {
    auditAliases(allNames, findings)
  }

  if (focus === 'all' || focus === 'duplicates') {
    auditDuplicates(ingredients, findings)
  }

  const report: AuditReport = {
    timestamp: new Date().toISOString(),
    totalIngredients: ingredients.length,
    findings,
    summary: {
      critical: findings.filter((f) => f.severity === 'critical').length,
      warning: findings.filter((f) => f.severity === 'warning').length,
      info: findings.filter((f) => f.severity === 'info').length,
      byArea: {
        nutrition: findings.filter((f) => f.area === 'nutrition').length,
        allergen: findings.filter((f) => f.area === 'allergen').length,
        alias: findings.filter((f) => f.area === 'alias').length,
        duplicate: findings.filter((f) => f.area === 'duplicate').length,
      },
    },
  }

  console.log(JSON.stringify(report, null, 2))
}

main()
  .catch((e) => {
    console.error('Audit failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
