import type { FormGuardResult } from './form-modifier-guard'
import { type FuzzyIngredientMatch, fuzzySearchIngredient } from './fuzzy-ingredient-match'

/**
 * The plant a "<plant> leaves" name means, when the best match does not name it:
 * "basil leaves" against `bay leaves` is `basil`. A herb or salad leaf the catalogue has
 * no "leaves" row for is its plant. A best match that holds every word of the plant
 * stays, so "lime leaves" keeps `kaffir lime leaves`. Null for any other name.
 */
export function leafPlantName(name: string, bestMatchedName: string | undefined): string | null {
  const plantName = name.replace(/\s+(leaves|leaf)$/, '')
  if (plantName === name) return null
  const bestWords = new Set(bestMatchedName?.toLowerCase().split(/\s+/) ?? [])
  return plantName.split(/\s+/).every((word) => bestWords.has(word)) ? null : plantName
}

/**
 * Search the plant of a "<plant> leaves" name and return its matches when they beat the
 * best match: "basil leaves" is `basil`, not the `bay leaves` its letters find (HON-1559).
 * Only a herb or a leafy vegetable is sure; any other row goes to review, because
 * "fig leaves" is not the fruit. Null when the name has no leaf word or the plant loses.
 */
export async function matchLeafPlant(
  normalizedName: string,
  best: FuzzyIngredientMatch | undefined,
  searchOptions: Parameters<typeof fuzzySearchIngredient>[1],
): Promise<{ matches: FuzzyIngredientMatch[]; formGuard: FormGuardResult } | null> {
  const plantName = leafPlantName(normalizedName, best?.matchedName)
  if (!plantName) return null
  const matches = await fuzzySearchIngredient(plantName, searchOptions)
  const plant = matches[0]
  if (!plant || plant.similarity <= (best?.similarity ?? 0)) return null
  const isLeafRow = plant.category === 'spice' || plant.category === 'vegetable'
  return {
    matches,
    formGuard: isLeafRow ? { action: 'keep' } : { action: 'flag', alternatives: matches },
  }
}
