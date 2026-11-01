import { singularize } from '@/lib/normalize-ingredient'

import type { FuzzyIngredientMatch } from './fuzzy-ingredient-match'
import { LOW_CONFIDENCE_THRESHOLD } from './recipe-confidence'

/**
 * Words for the form a food is sold in. Normalization strips them, but they change
 * the product: canned tomatoes are not fresh tomatoes (HON-1313). "canned" and
 * "tinned" are one form, written the catalogue's way.
 *
 * A bare meat or fish row is on the bone or whole, so "boneless" is a form too, and
 * the catalogue writes it "fillet": "boneless chicken thighs" is `chicken thigh
 * fillet` (HON-1480).
 */
const FORM_OF_WORD: Record<string, string> = {
  canned: 'tinned',
  tinned: 'tinned',
  frozen: 'frozen',
  dried: 'dried',
  boneless: 'boneless',
  deboned: 'boneless',
  fillet: 'boneless',
  fillets: 'boneless',
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

/** Note words that say how to prepare the food, not which food it is. */
const PREPARATION_NOTE_WORDS = new Set([
  'and',
  'drained',
  'rinsed',
  'soaked',
  'overnight',
  'chopped',
  'diced',
  'sliced',
  'minced',
  'grated',
  'peeled',
  'halved',
  'cooked',
])

/**
 * The food part of a recipe name. A note after a comma that only says how to
 * prepare the food is dropped, so "chickpeas, drained" is "chickpeas", and
 * "drained" cannot pull it to `dried chickpeas`. A form word in the note still
 * names the product, so it moves to the front: "chickpeas, dried" is "dried
 * chickpeas" (HON-1549). A note that offers a choice or a condition ("fresh or
 * frozen", "thawed if frozen") or names two forms states no one form, so it is
 * dropped. Any other note word may name the food ("sugar, brown", "salmon,
 * fillet"), so the name is kept as written.
 */
export function foodNameOf(name: string): string {
  const [rawHead = '', ...notes] = name.split(',')
  if (notes.length === 0) return name
  const head = rawHead.trim()
  const noteWords = wordsOf(notes.join(' '))
  if (noteWords.includes('or') || noteWords.includes('if')) return head
  const isMovableForm = (word: string) =>
    FORM_OF_WORD[word] !== undefined && !word.startsWith('fillet')
  if (!noteWords.every((word) => isMovableForm(word) || PREPARATION_NOTE_WORDS.has(word))) {
    return name
  }
  const headForms = formsOf(head)
  const noteForms = [
    ...new Set(
      noteWords.filter((word) => isMovableForm(word) && !headForms.has(FORM_OF_WORD[word]!)),
    ),
  ]
  if (new Set(noteForms.map((word) => FORM_OF_WORD[word])).size > 1) return head
  return [...noteForms, head].join(' ')
}

/** The recipe name in the catalogue's words, which say "tinned" for "canned". */
export function catalogueFormName(directName: string): string {
  return wordsOf(directName)
    .map((word) => (word === 'canned' ? 'tinned' : word))
    .join(' ')
}

/**
 * True when a fillet row lacks a cut word the recipe names between the food and
 * "fillet": "chicken leg fillet" is not `chicken fillet`, but "wild salmon fillet"
 * is `salmon fillet` (HON-1480).
 *
 * @param normalizedName - The normalized recipe name
 * @param rowName - The name the match was made on
 */
export function isOtherCutFillet(normalizedName: string, rowName: string): boolean {
  const rowWords = wordsOf(rowName).map(singularize)
  if (!rowWords.includes('fillet')) return false
  const cutWords = wordsOf(normalizedName).map(singularize)
  const from = cutWords.indexOf(rowWords[0] ?? '')
  const filletAt = cutWords.indexOf('fillet')
  const to = filletAt >= 0 ? filletAt : cutWords.length
  const cutBetween = from >= 0 && to > from ? cutWords.slice(from + 1, to) : []
  return cutBetween.some((word) => !rowWords.includes(word))
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
 * @param normalizedName - The normalized recipe name; its last word is the food, or all
 *   its words for a boneless cut
 * @param winner - The normalized candidate's top match
 * @param directSide - Result lists for the direct name, its alias and its catalogue-form name
 *   (for a boneless cut, the normalized name with "fillet")
 */
export function guardFormMatch(
  forms: string[],
  normalizedName: string,
  winner: FuzzyIngredientMatch,
  directSide: FuzzyIngredientMatch[][],
): FormGuardResult {
  if (forms.length === 0 || hasForm(winner.matchedName, forms)) return { action: 'keep' }

  // A cut is named by all its words: "boneless chicken thigh" is not `turkey thigh fillet`
  const normalizedWords = wordsOf(normalizedName).map(singularize)
  const foodWords = forms.includes('boneless') ? normalizedWords : normalizedWords.slice(-1)
  const isFormRow = (match: FuzzyIngredientMatch) => {
    const rowWords = wordsOf(match.matchedName).map(singularize)
    return hasForm(match.matchedName, forms) && foodWords.every((word) => rowWords.includes(word))
  }

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
