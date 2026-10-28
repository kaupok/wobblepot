import { applyEntryChanges } from '@/lib/meal-planning/entry-components'

// Shared fixtures of the `change_meal_ingredients` tests: a planned trout for
// 4, its changes, and the catalogue the mocked matcher reads.

export const ingredient = (name: string, defaultUnit: 'g' | 'piece' = 'g') => ({
  name,
  defaultUnit,
  measuredByVolume: false,
  translations: [],
})
export const component = (id: string, quantityPerServing: number) => ({
  ingredientId: id,
  quantityPerServing,
  isVague: false,
  originalPhrase: null,
  ingredient: ingredient(id),
})
export const change = (
  id: string,
  original: string | null,
  replacement: string | null,
  quantityPerServing: number | null = null,
) => ({
  id,
  originalIngredientId: original,
  replacementIngredientId: replacement,
  quantityPerServing,
  replacementIngredient: replacement ? ingredient(replacement) : null,
})

export const TROUT = [
  component('trout', 150),
  component('potato', 200),
  component('carrot', 80),
  component('oil', 10),
]

/** A planned trout for 4, with `changes` applied as the read applies them. */
export function entry(
  changes: ReturnType<typeof change>[] = [],
  recipe = TROUT,
  status = 'planned',
) {
  return {
    id: 'entry-1',
    planId: 'plan-a',
    status,
    servingOverride: 4,
    cookedServings: null,
    leftoverItems: [],
    meal: { id: 'meal-trout', name: 'Trout', translations: [], components: recipe },
    changes,
    components: applyEntryChanges(recipe, changes),
  }
}

export function slot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    planId: 'plan-a',
    mealType: 'dinner',
    mealId: 'meal-trout',
    status: 'planned',
    rating: null,
    servingOverride: 4,
    cookedServings: null,
    leftoverItems: [],
    meal: { id: 'meal-trout', name: 'Trout', timeMinutes: 30, primaryProteinType: null },
    ...overrides,
  }
}

/** The catalogue: a name matches itself, `egg` is counted with no known weight. */
export const CATALOGUE: Record<string, { defaultUnit: 'g' | 'piece'; lowConfidence?: boolean }> = {
  rice: { defaultUnit: 'g' },
  broccoli: { defaultUnit: 'g' },
  carrot: { defaultUnit: 'g' },
  milk: { defaultUnit: 'g' },
  egg: { defaultUnit: 'piece' },
  peas: { defaultUnit: 'g' },
  quinoa: { defaultUnit: 'g', lowConfidence: true },
}

export const POTATO_RICE = change('c1', 'potato', 'rice', 75)
export const NO_CARROT = change('c2', 'carrot', null)
export const BROCCOLI = change('c3', null, 'broccoli', 100)

export const row = (
  original: string | null,
  replacement: string | null,
  quantity: number | null,
) => ({
  originalIngredientId: original,
  replacementIngredientId: replacement,
  quantityPerServing: quantity,
})
