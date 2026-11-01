import type { FormGuardResult } from './form-modifier-guard'
import { type FuzzyIngredientMatch, fuzzySearchIngredient } from './fuzzy-ingredient-match'
import { VERY_LOW_CONFIDENCE_THRESHOLD } from './recipe-confidence'

const ENDS_IN_LEAF = /\s(leaves|leaf)$/
const HAS_LEAF_WORD = /\b(leaves|leaf)\b/

/**
 * The plant a "<plant> leaves" name means, when the best match does not name it:
 * "basil leaves" against `bay leaves` is `basil`. A herb or salad leaf the catalogue has
 * no "leaves" row for is its plant. A best match that holds every word of the plant
 * stays, so "lime leaves" keeps `kaffir lime leaves`. Null for any other name.
 */
export function leafPlantName(name: string, bestMatchedName: string | undefined): string | null {
  const plantName = name.replace(ENDS_IN_LEAF, '')
  if (plantName === name) return null
  const bestWords = new Set(bestMatchedName?.toLowerCase().split(/\s+/) ?? [])
  return plantName.split(/\s+/).every((word) => bestWords.has(word)) ? null : plantName
}

/**
 * Judge a "<plant> leaves" name against the plant row: "basil leaves" is `basil`, not the
 * `bay leaves` its letters find (HON-1559). When the best match does not name the plant,
 * the plant is searched and wins on a higher score. Only a herb or a leafy vegetable is
 * sure; any other plant row goes to review, because "fig leaves" and "lemon leaves" are
 * not the fruit. Null when the name has no leaf word or the result stands as it is.
 */
export async function matchLeafPlant(
  normalizedName: string,
  matches: FuzzyIngredientMatch[],
  searchOptions: Parameters<typeof fuzzySearchIngredient>[1],
): Promise<{ matches: FuzzyIngredientMatch[]; formGuard: FormGuardResult } | null> {
  const best = matches[0]
  // A best match too weak to keep loses to the last-word fallback's `bay leaves`, so it
  // does not count as naming the plant: "thyme leaves" scores 0.545 against `thyme`.
  const keptBest = best && best.similarity >= VERY_LOW_CONFIDENCE_THRESHOLD ? best : undefined
  const plantName = leafPlantName(normalizedName, keptBest?.matchedName)
  let plantMatches = matches
  if (plantName) {
    plantMatches = await fuzzySearchIngredient(plantName, searchOptions)
    if (!plantMatches[0] || plantMatches[0].similarity <= (best?.similarity ?? 0)) return null
  } else if (
    !ENDS_IN_LEAF.test(normalizedName) ||
    !keptBest ||
    HAS_LEAF_WORD.test(keptBest.matchedName.toLowerCase())
  ) {
    // No leaf word, or a leaf row such as `bay leaves` names the plant: it stands
    return null
  }
  const plant = plantMatches[0]!
  const isLeafRow = plant.category === 'spice' || plant.category === 'vegetable'
  if (isLeafRow) return plantName ? { matches: plantMatches, formGuard: { action: 'keep' } } : null
  return { matches: plantMatches, formGuard: { action: 'flag', alternatives: plantMatches } }
}
