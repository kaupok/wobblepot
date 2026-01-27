/**
 * Seed Data Validation Script
 *
 * Validates seed data before database seeding to catch:
 * - Hard errors: duplicates, invalid references, unit mismatches, missing fields
 * - Warnings: nutritional outliers, unused ingredients, fiber > carbs
 * - Naming conventions: lowercase, trimmed, no punctuation
 * - Nutritional plausibility: Atwater formula cross-check
 * - Near-duplicates: Levenshtein distance for similar names
 * - Category consistency: proteinType vs category alignment
 * - Coverage report: ingredient counts by category and subcategory
 *
 * Run: pnpm db:validate
 */

import { baseIngredients, baseMeals } from './seed'
import { newIngredients, newMeals } from './seed-expansion'
import { INGREDIENT_ALIASES } from '../src/lib/ingredient-aliases'

// ============================================
// TYPES
// ============================================

type Ingredient = (typeof baseIngredients)[number]
type Meal = (typeof baseMeals)[number]

type ValidationResult = {
  errors: string[]
  warnings: string[]
}

// ============================================
// VALID ENUM VALUES (from Prisma schema)
// ============================================

const VALID_CATEGORIES = [
  'protein',
  'carb',
  'vegetable',
  'fruit',
  'dairy',
  'fat',
  'legume',
  'condiment',
  'spice',
] as const

const VALID_UNITS = ['g', 'piece'] as const

const VALID_ALLERGENS = [
  'gluten',
  'dairy',
  'eggs',
  'nuts',
  'peanuts',
  'soy',
  'fish',
  'shellfish',
  'sesame',
] as const

const VALID_PROTEIN_TYPES = [
  'poultry',
  'beef',
  'pork',
  'lamb',
  'fish',
  'eggs',
  'legume',
  'dairy',
  'none',
] as const

const VALID_MEAL_TYPES = ['breakfast', 'lunch', 'dinner'] as const

// ============================================
// VALIDATION THRESHOLDS
// ============================================

const THRESHOLDS = {
  // Per 100g
  caloriesMin: 0,
  caloriesMax: 900,
  proteinMin: 0,
  proteinMax: 50,
  carbsMin: 0,
  carbsMax: 100,
  fatMin: 0,
  fatMax: 100,
  // Piece-based quantity (quantities above this are suspicious for piece units)
  pieceQuantityMax: 5,
  // Meal component counts
  componentsMin: 3,
  componentsMax: 15,
}

// ============================================
// VALIDATION FUNCTIONS
// ============================================

function validateIngredientFields(ingredients: Ingredient[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  for (const ing of ingredients) {
    const name = ing.name

    // Required fields
    if (!ing.name) {
      errors.push(`Ingredient missing 'name' field`)
      continue
    }
    if (!ing.category) {
      errors.push(`${name}: missing 'category' field`)
    }
    if (ing.defaultUnit === undefined) {
      errors.push(`${name}: missing 'defaultUnit' field`)
    }
    if (ing.calories === undefined) {
      errors.push(`${name}: missing 'calories' field`)
    }
    if (ing.protein === undefined) {
      errors.push(`${name}: missing 'protein' field`)
    }
    if (ing.carbs === undefined) {
      errors.push(`${name}: missing 'carbs' field`)
    }
    if (ing.fat === undefined) {
      errors.push(`${name}: missing 'fat' field`)
    }

    // Valid enum values
    if (
      ing.category &&
      !VALID_CATEGORIES.includes(ing.category as (typeof VALID_CATEGORIES)[number])
    ) {
      errors.push(`${name}: invalid category '${ing.category}'`)
    }
    if (ing.defaultUnit && !VALID_UNITS.includes(ing.defaultUnit as (typeof VALID_UNITS)[number])) {
      errors.push(`${name}: invalid defaultUnit '${ing.defaultUnit}'`)
    }
    if (ing.proteinType) {
      const pt = ing.proteinType as string
      if (!VALID_PROTEIN_TYPES.includes(pt as (typeof VALID_PROTEIN_TYPES)[number])) {
        errors.push(`${name}: invalid proteinType '${pt}'`)
      }
    }

    // Allergens validation
    if (ing.allergens) {
      for (const allergen of ing.allergens) {
        if (!VALID_ALLERGENS.includes(allergen as (typeof VALID_ALLERGENS)[number])) {
          errors.push(`${name}: invalid allergen '${allergen}'`)
        }
      }
    }

    // gramsPerPiece required when defaultUnit is 'piece'
    if (ing.defaultUnit === 'piece') {
      const hasGramsPerPiece = 'gramsPerPiece' in ing && ing.gramsPerPiece !== undefined
      if (!hasGramsPerPiece) {
        errors.push(`${name}: missing 'gramsPerPiece' (required when defaultUnit is 'piece')`)
      }
    }
  }

  return { errors, warnings }
}

function validateNutritionalValues(ingredients: Ingredient[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  for (const ing of ingredients) {
    const name = ing.name

    // Calorie outliers
    if (ing.calories < THRESHOLDS.caloriesMin || ing.calories > THRESHOLDS.caloriesMax) {
      warnings.push(
        `${name}: calories ${ing.calories} outside typical range (${THRESHOLDS.caloriesMin}-${THRESHOLDS.caloriesMax} per 100g)`,
      )
    }

    // Protein outliers
    if (ing.protein < THRESHOLDS.proteinMin || ing.protein > THRESHOLDS.proteinMax) {
      warnings.push(
        `${name}: protein ${ing.protein}g outside typical range (${THRESHOLDS.proteinMin}-${THRESHOLDS.proteinMax} per 100g)`,
      )
    }

    // Carbs outliers
    if (ing.carbs < THRESHOLDS.carbsMin || ing.carbs > THRESHOLDS.carbsMax) {
      warnings.push(
        `${name}: carbs ${ing.carbs}g outside typical range (${THRESHOLDS.carbsMin}-${THRESHOLDS.carbsMax} per 100g)`,
      )
    }

    // Fat outliers
    if (ing.fat < THRESHOLDS.fatMin || ing.fat > THRESHOLDS.fatMax) {
      warnings.push(
        `${name}: fat ${ing.fat}g outside typical range (${THRESHOLDS.fatMin}-${THRESHOLDS.fatMax} per 100g)`,
      )
    }

    // Fiber > carbs check (fiber can't exceed total carbs)
    if (ing.fiber !== undefined && ing.fiber > ing.carbs) {
      warnings.push(`${name}: fiber (${ing.fiber}g) > carbs (${ing.carbs}g) - check data source`)
    }
  }

  return { errors, warnings }
}

function validateMealReferences(
  meals: Meal[],
  ingredientMap: Map<string, Ingredient>,
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  for (const meal of meals) {
    // Check for unknown ingredients
    for (const comp of meal.components) {
      if (!ingredientMap.has(comp.ingredient)) {
        errors.push(`${meal.name}: unknown ingredient '${comp.ingredient}'`)
      }
    }

    // Valid suitableFor values
    for (const mealType of meal.suitableFor) {
      if (!VALID_MEAL_TYPES.includes(mealType as (typeof VALID_MEAL_TYPES)[number])) {
        errors.push(`${meal.name}: invalid suitableFor value '${mealType}'`)
      }
    }

    // Valid primaryProteinType
    if (meal.primaryProteinType) {
      if (
        !VALID_PROTEIN_TYPES.includes(
          meal.primaryProteinType as (typeof VALID_PROTEIN_TYPES)[number],
        )
      ) {
        errors.push(`${meal.name}: invalid primaryProteinType '${meal.primaryProteinType}'`)
      }
    }
  }

  return { errors, warnings }
}

function checkPieceUnitQuantities(
  meals: Meal[],
  ingredientMap: Map<string, Ingredient>,
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  for (const meal of meals) {
    for (const comp of meal.components) {
      const ingredient = ingredientMap.get(comp.ingredient)
      if (!ingredient) continue // Already reported in reference validation

      if (ingredient.defaultUnit === 'piece' && comp.quantity > THRESHOLDS.pieceQuantityMax) {
        errors.push(
          `${meal.name}: '${comp.ingredient}' quantity ${comp.quantity} looks like grams (unit is 'piece', max expected: ${THRESHOLDS.pieceQuantityMax})`,
        )
      }
    }
  }

  return { errors, warnings }
}

function checkMealComponentCounts(meals: Meal[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  for (const meal of meals) {
    const count = meal.components.length

    if (count < THRESHOLDS.componentsMin) {
      warnings.push(
        `${meal.name}: has only ${count} components (min recommended: ${THRESHOLDS.componentsMin})`,
      )
    }

    if (count > THRESHOLDS.componentsMax) {
      warnings.push(
        `${meal.name}: has ${count} components (max recommended: ${THRESHOLDS.componentsMax})`,
      )
    }
  }

  return { errors, warnings }
}

function findUnusedIngredients(ingredients: Ingredient[], meals: Meal[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const usedNames = new Set(meals.flatMap((m) => m.components.map((c) => c.ingredient)))
  const unused = ingredients.filter((i) => !usedNames.has(i.name))

  if (unused.length > 0) {
    warnings.push(`${unused.length} unused ingredients (not referenced by any meal)`)
  }

  return { errors, warnings }
}

function validateIngredientAliases(ingredientNames: Set<string>): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  for (const [from, to] of Object.entries(INGREDIENT_ALIASES)) {
    if (!ingredientNames.has(to)) {
      errors.push(
        `Ingredient alias "${from}" → "${to}" points to non-existent ingredient. ` +
          `Either add "${to}" to seed data or remove this alias.`,
      )
    }
  }

  return { errors, warnings }
}

function validateNamingConventions(ingredients: Ingredient[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  for (const ing of ingredients) {
    const name = ing.name

    if (name !== name.toLowerCase()) {
      errors.push(`${name}: name must be lowercase`)
    }

    if (name !== name.trim()) {
      errors.push(`'${name}': name has leading or trailing whitespace`)
    }

    if (name.includes('  ')) {
      errors.push(`${name}: name contains double spaces`)
    }

    if (/[.,;!?]$/.test(name)) {
      errors.push(`${name}: name ends with punctuation`)
    }
  }

  return { errors, warnings }
}

function validateCalorieSanity(ingredients: Ingredient[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  for (const ing of ingredients) {
    const name = ing.name

    // Atwater formula: cal ≈ protein×4 + carbs×4 + fat×9
    // Fiber contributes ~2 cal/g instead of 4, but fiber is optional
    // so we use the simple formula with a generous tolerance
    const expected = ing.protein * 4 + ing.carbs * 4 + ing.fat * 9
    const actual = ing.calories
    const diff = Math.abs(actual - expected)
    const pctDiff = expected > 0 ? diff / expected : actual > 0 ? 1 : 0

    // Flag if >25% off AND >40 kcal absolute difference
    // This avoids false positives for low-calorie items (spices, water)
    // and items with significant fiber or alcohol content
    if (diff > 40 && pctDiff > 0.25) {
      warnings.push(
        `${name}: calories ${actual} vs Atwater estimate ${Math.round(expected)} (${Math.round(pctDiff * 100)}% off, ${Math.round(diff)} kcal diff)`,
      )
    }
  }

  return { errors, warnings }
}

function checkNearDuplicateNames(ingredients: Ingredient[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const names = ingredients.map((i) => i.name)

  function levenshtein(a: string, b: string): number {
    const m = a.length
    const n = b.length
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0))
    for (let i = 0; i <= m; i++) dp[i]![0] = i
    for (let j = 0; j <= n; j++) dp[0]![j] = j
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i]![j] = Math.min(
          dp[i - 1]![j]! + 1,
          dp[i]![j - 1]! + 1,
          dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
        )
      }
    }
    return dp[m]![n]!
  }

  // Check all pairs - O(n²) but fine for <1000 ingredients
  const reported = new Set<string>()
  for (let i = 0; i < names.length; i++) {
    const a = names[i]!
    for (let j = i + 1; j < names.length; j++) {
      const b = names[j]!

      // Skip exact duplicates (caught by duplicate check)
      if (a === b) continue

      // Only compare names of similar length to avoid
      // flagging intentional compounds like "rice" vs "rice vinegar"
      const lenDiff = Math.abs(a.length - b.length)
      if (lenDiff > 3) continue

      const maxDist = Math.max(a.length, b.length) < 8 ? 1 : 2
      const dist = levenshtein(a, b)
      if (dist <= maxDist) {
        const key = [a, b].sort().join('|')
        if (!reported.has(key)) {
          warnings.push(`Near-duplicate: "${a}" ↔ "${b}" (edit distance: ${dist})`)
          reported.add(key)
        }
      }
    }
  }

  return { errors, warnings }
}

function validateProteinTypeConsistency(ingredients: Ingredient[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  for (const ing of ingredients) {
    const name = ing.name

    // Protein category should have a proteinType
    if (ing.category === 'protein' && !ing.proteinType) {
      warnings.push(`${name}: category is 'protein' but no proteinType set`)
    }

    // Non-protein/legume/dairy categories having a meaningful proteinType is suspicious
    if (
      ing.proteinType &&
      ing.proteinType !== 'none' &&
      !['protein', 'legume', 'dairy'].includes(ing.category)
    ) {
      warnings.push(
        `${name}: category '${ing.category}' has proteinType '${ing.proteinType}' - verify this is intentional`,
      )
    }
  }

  return { errors, warnings }
}

function checkDuplicateIngredientsMulti(sources: Record<string, Ingredient[]>): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const entries = Object.entries(sources)

  // Check duplicates within each source
  for (const [sourceName, ingredients] of entries) {
    const seen = new Set<string>()
    for (const ing of ingredients) {
      if (seen.has(ing.name)) {
        errors.push(`Duplicate ingredient in ${sourceName}: ${ing.name}`)
      }
      seen.add(ing.name)
    }
  }

  // Check duplicates across sources
  for (let i = 0; i < entries.length; i++) {
    const [nameI, ingredientsI] = entries[i]!
    const namesI = new Set(ingredientsI.map((ing) => ing.name))
    for (let j = i + 1; j < entries.length; j++) {
      const [nameJ, ingredientsJ] = entries[j]!
      for (const ing of ingredientsJ) {
        if (namesI.has(ing.name)) {
          errors.push(
            `Duplicate ingredient across files: '${ing.name}' exists in both ${nameI} and ${nameJ}`,
          )
        }
      }
    }
  }

  return { errors, warnings }
}

function checkDuplicateMealsMulti(sources: Record<string, Meal[]>): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const entries = Object.entries(sources)

  // Check duplicates within each source
  for (const [sourceName, meals] of entries) {
    const seen = new Set<string>()
    for (const meal of meals) {
      if (seen.has(meal.name)) {
        errors.push(`Duplicate meal in ${sourceName}: ${meal.name}`)
      }
      seen.add(meal.name)
    }
  }

  // Check duplicates across sources
  for (let i = 0; i < entries.length; i++) {
    const [nameI, mealsI] = entries[i]!
    const namesI = new Set(mealsI.map((m) => m.name))
    for (let j = i + 1; j < entries.length; j++) {
      const [nameJ, mealsJ] = entries[j]!
      for (const meal of mealsJ) {
        if (namesI.has(meal.name)) {
          errors.push(
            `Duplicate meal across files: '${meal.name}' exists in both ${nameI} and ${nameJ}`,
          )
        }
      }
    }
  }

  return { errors, warnings }
}

function reportCategoryCoverage(ingredients: Ingredient[]): void {
  const byCategory = new Map<string, number>()
  const bySubcategory = new Map<string, number>()

  for (const ing of ingredients) {
    byCategory.set(ing.category, (byCategory.get(ing.category) ?? 0) + 1)
    if (ing.subcategory) {
      const key = `${ing.category}/${ing.subcategory}`
      bySubcategory.set(key, (bySubcategory.get(key) ?? 0) + 1)
    }
  }

  console.log(`\n📦 Category coverage:`)
  for (const cat of VALID_CATEGORIES) {
    console.log(`   ${cat}: ${byCategory.get(cat) ?? 0}`)
  }

  console.log(`\n📁 Subcategory breakdown:`)
  const sorted = [...bySubcategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [key, count] of sorted) {
    console.log(`   ${key}: ${count}`)
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('🔍 Validating seed data...\n')

  // Ingredient sources — add new seed files here
  const ingredientSources: Record<string, Ingredient[]> = {
    'seed.ts': baseIngredients,
    'seed-expansion.ts': newIngredients,
  }

  // Meal sources — add new seed files here
  const mealSources: Record<string, Meal[]> = {
    'seed.ts': baseMeals,
    'seed-expansion.ts': newMeals,
  }

  const allIngredients = Object.values(ingredientSources).flat()
  const allMeals = Object.values(mealSources).flat()

  // Build ingredient map for reference lookups
  const ingredientMap = new Map<string, Ingredient>()
  for (const ing of allIngredients) {
    ingredientMap.set(ing.name, ing)
  }

  // Build ingredient name set for alias validation
  const ingredientNames = new Set(allIngredients.map((ing) => ing.name))

  // Run all validations
  const results: ValidationResult[] = [
    // Field and enum validation
    validateIngredientFields(allIngredients),
    validateNamingConventions(allIngredients),
    validateProteinTypeConsistency(allIngredients),

    // Nutritional quality
    validateNutritionalValues(allIngredients),
    validateCalorieSanity(allIngredients),

    // Duplicate detection
    checkDuplicateIngredientsMulti(ingredientSources),
    checkDuplicateMealsMulti(mealSources),
    checkNearDuplicateNames(allIngredients),

    // Reference integrity
    validateMealReferences(allMeals, ingredientMap),
    checkPieceUnitQuantities(allMeals, ingredientMap),
    checkMealComponentCounts(allMeals),
    findUnusedIngredients(allIngredients, allMeals),
    validateIngredientAliases(ingredientNames),
  ]

  // Aggregate results
  const errors = results.flatMap((r) => r.errors)
  const warnings = results.flatMap((r) => r.warnings)

  // Report summary
  const sourceCounts = Object.entries(ingredientSources)
    .map(([name, arr]) => `${arr.length} ${name.replace('.ts', '')}`)
    .join(' + ')
  const mealCounts = Object.entries(mealSources)
    .map(([name, arr]) => `${arr.length} ${name.replace('.ts', '')}`)
    .join(' + ')

  console.log(`📊 Summary:`)
  console.log(`   ${allIngredients.length} ingredients (${sourceCounts})`)
  console.log(`   ${allMeals.length} meals (${mealCounts})`)
  console.log(`   ${Object.keys(INGREDIENT_ALIASES).length} ingredient aliases`)

  // Category coverage report
  reportCategoryCoverage(allIngredients)

  // Report warnings
  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} warning(s):`)
    for (const w of warnings) {
      console.log(`   - ${w}`)
    }
  }

  // Report errors and exit
  if (errors.length > 0) {
    console.log(`\n❌ ${errors.length} error(s):`)
    for (const e of errors) {
      console.log(`   - ${e}`)
    }
    console.log('\n❌ Seed data validation FAILED')
    process.exit(1)
  }

  console.log('\n✅ Seed data validation passed')
}

main().catch((e) => {
  console.error('Validation script error:', e)
  process.exit(1)
})
