/**
 * Seed Data Validation Script
 *
 * Validates seed data before database seeding to catch:
 * - Hard errors: duplicates, invalid references, unit mismatches, missing fields
 * - Warnings: nutritional outliers, unused ingredients, fiber > carbs
 *
 * Run: pnpm db:validate
 */

import { baseIngredients, baseMeals } from './seed'
import { newIngredients, newMeals } from './seed-expansion'

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

function checkDuplicateIngredients(base: Ingredient[], expansion: Ingredient[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Check duplicates within base
  const baseNames = new Set<string>()
  for (const ing of base) {
    if (baseNames.has(ing.name)) {
      errors.push(`Duplicate ingredient in seed.ts: ${ing.name}`)
    }
    baseNames.add(ing.name)
  }

  // Check duplicates within expansion
  const expansionNames = new Set<string>()
  for (const ing of expansion) {
    if (expansionNames.has(ing.name)) {
      errors.push(`Duplicate ingredient in seed-expansion.ts: ${ing.name}`)
    }
    expansionNames.add(ing.name)
  }

  // Check duplicates across files
  for (const ing of expansion) {
    if (baseNames.has(ing.name)) {
      errors.push(
        `Duplicate ingredient across files: '${ing.name}' exists in both seed.ts and seed-expansion.ts`,
      )
    }
  }

  return { errors, warnings }
}

function checkDuplicateMeals(base: Meal[], expansion: Meal[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Check duplicates within base
  const baseNames = new Set<string>()
  for (const meal of base) {
    if (baseNames.has(meal.name)) {
      errors.push(`Duplicate meal in seed.ts: ${meal.name}`)
    }
    baseNames.add(meal.name)
  }

  // Check duplicates within expansion
  const expansionNames = new Set<string>()
  for (const meal of expansion) {
    if (expansionNames.has(meal.name)) {
      errors.push(`Duplicate meal in seed-expansion.ts: ${meal.name}`)
    }
    expansionNames.add(meal.name)
  }

  // Check duplicates across files
  for (const meal of expansion) {
    if (baseNames.has(meal.name)) {
      errors.push(
        `Duplicate meal across files: '${meal.name}' exists in both seed.ts and seed-expansion.ts`,
      )
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

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('🔍 Validating seed data...\n')

  const allIngredients = [...baseIngredients, ...newIngredients]
  const allMeals = [...baseMeals, ...newMeals]

  // Build ingredient map for reference lookups
  const ingredientMap = new Map<string, Ingredient>()
  for (const ing of allIngredients) {
    ingredientMap.set(ing.name, ing)
  }

  // Run all validations
  const results: ValidationResult[] = [
    validateIngredientFields(allIngredients),
    validateNutritionalValues(allIngredients),
    checkDuplicateIngredients(baseIngredients, newIngredients),
    checkDuplicateMeals(baseMeals, newMeals),
    validateMealReferences(allMeals, ingredientMap),
    checkPieceUnitQuantities(allMeals, ingredientMap),
    checkMealComponentCounts(allMeals),
    findUnusedIngredients(allIngredients, allMeals),
  ]

  // Aggregate results
  const errors = results.flatMap((r) => r.errors)
  const warnings = results.flatMap((r) => r.warnings)

  // Report summary
  console.log(`📊 Summary:`)
  console.log(
    `   ${allIngredients.length} ingredients (${baseIngredients.length} base + ${newIngredients.length} expansion)`,
  )
  console.log(
    `   ${allMeals.length} meals (${baseMeals.length} base + ${newMeals.length} expansion)`,
  )

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
