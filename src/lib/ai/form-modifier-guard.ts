import { singularize } from '@/lib/normalize-ingredient'

import type { FuzzyIngredientMatch } from './fuzzy-ingredient-match'
import { LOW_CONFIDENCE_THRESHOLD } from './recipe-confidence'

/**
 * Words for the form a food is sold in. Normalization strips them, but they change
 * the product: canned tomatoes are not fresh tomatoes (HON-1313). "canned" and
 * "tinned" are one form, written the catalogue's way.
 */
const FORM_OF_WORD: Record<string, string> = {
  canned: 'tinned',
  tinned: 'tinned',
  frozen: 'frozen',
  dried: 'dried',
}

function wordsOf(name: string): string[] {
  return name.toLowerCase().trim().split(/\s+/)
}

function formsOf(name: string): Set<string> {
  return new Set(wordsOf(name).flatMap((word) => FORM_OF_WORD[word] ?? []))
}

/** The forms in the recipe name that normalization removed: "canned chopped tomatoes" → tinned. */
export function removedForms(directName: string, normalizedName: string): string[] {
  const kept = formsOf(normalizedName)
  return [...formsOf(directName)].filter((form) => !kept.has(form))
}

/** True when the name carries one of the forms: "tinned chopped tomatoes" carries tinned. */
export function hasForm(name: string, forms: string[]): boolean {
  const named = formsOf(name)
  return forms.some((form) => named.has(form))
}

/** The recipe name in the catalogue's words, which say "tinned" for "canned". */
export function catalogueFormName(directName: string): string {
  return wordsOf(directName)
    .map((word) => (word === 'canned' ? 'tinned' : word))
    .join(' ')
}

export type FormGuardResult =
  | { action: 'keep' }
  | { action: 'use'; matches: FuzzyIngredientMatch[] }
  | { action: 'flag'; alternatives: FuzzyIngredientMatch[] }

/**
 * Judge a match the normalized name won after normalization removed a form word.
 * A form row is a row that names the form and the same food: "tinned chopped
 * tomatoes" for "canned crushed tomatoes".
 *
 * - `use`: a direct-side list's top match is a form row at a sure score, so it replaces the winner.
 * - `flag`: a form row exists but is not sure, so the winner needs review, with form rows first.
 * - `keep`: the catalogue has no form row for this food, so the stripped name is right:
 *   "dried cumin" → `cumin` when there is no "dried cumin".
 *
 * @param forms - The forms normalization removed, from `removedForms`
 * @param normalizedName - The normalized recipe name; its last word is the food
 * @param winner - The normalized candidate's top match
 * @param directSide - Result lists for the direct name, its alias and its catalogue-form name
 */
export function guardFormMatch(
  forms: string[],
  normalizedName: string,
  winner: FuzzyIngredientMatch,
  directSide: FuzzyIngredientMatch[][],
): FormGuardResult {
  if (forms.length === 0 || hasForm(winner.matchedName, forms)) return { action: 'keep' }

  const food = singularize(wordsOf(normalizedName).at(-1) ?? '')
  const isFormRow = (match: FuzzyIngredientMatch) =>
    hasForm(match.matchedName, forms) && wordsOf(match.matchedName).map(singularize).includes(food)

  const sureLists = directSide.filter(
    (list) => list[0] && isFormRow(list[0]) && list[0].similarity >= LOW_CONFIDENCE_THRESHOLD,
  )
  const best = sureLists.sort((a, b) => b[0]!.similarity - a[0]!.similarity)[0]
  if (best) return { action: 'use', matches: best }

  const formRows = directSide
    .flat()
    .filter(isFormRow)
    .sort((a, b) => b.similarity - a.similarity)
  if (formRows.length === 0) return { action: 'keep' }

  const seen = new Set<string>()
  const alternatives = [...formRows, ...(directSide[0] ?? [])].filter((match) => {
    if (seen.has(match.id)) return false
    seen.add(match.id)
    return true
  })
  return { action: 'flag', alternatives: alternatives.slice(0, 3) }
}
