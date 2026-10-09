import { findViolations, normalizeFoodName, rulesForHousehold } from '@/lib/ai/forbidden-foods'

/**
 * One household food preference a planned meal breaks (HON-1126). The planner
 * card and the cook view render one badge per conflict; the preferences save
 * counts the planned meals that have any.
 *
 * `constraint` is the `Allergen` or `DietaryType` value for those kinds, so the
 * badge can read its enum label. For `excluded` it is the ingredient's
 * canonical name, kept for logs: the badge does not name it.
 */
export interface PreferenceConflict {
  kind: 'allergen' | 'diet' | 'excluded'
  constraint: string
}

/** The parts of a meal the check reads, with canonical (untranslated) names. */
export interface ConflictCheckedMeal {
  name: string
  components: readonly {
    ingredientId: string
    ingredient: { name: string; allergens: readonly string[] }
  }[]
}

/** The `HouseholdPreferences` fields the check reads. */
export interface ConflictPreferences {
  dietaryType: string | null
  allergensToAvoid: readonly string[]
  excludedIngredients: readonly string[]
  excludedIngredientIds: readonly string[]
}

/**
 * Every household food preference `meal` breaks, at most one per allergen, one
 * for the diet and one for the avoided ingredients. Empty means the meal fits.
 *
 * Allergens are read from the ingredient's structured `allergens` first. The
 * keyword lists in `forbidden-foods` then check the meal name and the
 * ingredients with no allergen data, which catches "Kalamaki" by name. An
 * ingredient with allergen data is not keyword-checked for allergens, because
 * its data is the better answer. The diet has no structured data, so it is
 * keyword-checked on every ingredient name, as the imagine guard does.
 */
export function findPreferenceConflicts(
  meal: ConflictCheckedMeal,
  preferences: ConflictPreferences,
): PreferenceConflict[] {
  const conflicts: PreferenceConflict[] = []
  const seen = new Set<string>()
  const add = (conflict: PreferenceConflict) => {
    const key = `${conflict.kind}:${conflict.constraint}`
    if (seen.has(key)) return
    seen.add(key)
    conflicts.push(conflict)
  }

  const avoided = new Set(preferences.allergensToAvoid)
  for (const { ingredient } of meal.components) {
    for (const allergen of ingredient.allergens) {
      if (avoided.has(allergen)) add({ kind: 'allergen', constraint: allergen })
    }
  }

  const rules = rulesForHousehold({
    allergens: preferences.allergensToAvoid,
    dietaryType: preferences.dietaryType,
  })
  const allergenRules = rules.filter((rule) => rule.kind === 'allergen')
  const dietRules = rules.filter((rule) => rule.kind === 'diet')
  const ingredientNames = (untagged: boolean) =>
    meal.components
      .filter((c) => !untagged || c.ingredient.allergens.length === 0)
      .map((c) => ({ name: c.ingredient.name }))

  for (const violation of findViolations(
    { name: meal.name, ingredients: ingredientNames(true) },
    allergenRules,
  )) {
    add({ kind: 'allergen', constraint: violation.constraint })
  }
  for (const violation of findViolations(
    { name: meal.name, ingredients: ingredientNames(false) },
    dietRules,
  )) {
    add({ kind: 'diet', constraint: violation.constraint })
  }

  // One badge for every avoided ingredient: its label does not name it.
  const excludedIds = new Set(preferences.excludedIngredientIds)
  const excludedNames = new Set(preferences.excludedIngredients.map(normalizeFoodName))
  const excluded = meal.components.find(
    (c) =>
      excludedIds.has(c.ingredientId) || excludedNames.has(normalizeFoodName(c.ingredient.name)),
  )
  if (excluded) add({ kind: 'excluded', constraint: excluded.ingredient.name })

  return conflicts
}
