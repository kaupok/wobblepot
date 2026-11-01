import { extractLastWord, pluralize, singularize } from '@/lib/normalize-ingredient'

// Checks that judge a fuzzy match by its words, not its score: a trigram score cannot
// tell a different food that shares most letters from the same food.

const COMMON_SUFFIXES = new Set([
  'fillet',
  'breast',
  'thigh',
  'leg',
  'wing',
  'steak',
  'chop',
  'loin',
  'rib',
])

// The marks `synonymKey` reads as a space, so "chia seemned" and "chia-seemned" have
// the same words (HON-1547).
const WORD_BREAK = /[\s‐–-]+/

/**
 * Whether each name has a word the other lacks: "trout fillet" against `cod fillet`.
 * Singular words on both sides, so "bay leaf" is not judged against "bay leaves" as a
 * different noun (HON-1267).
 */
export function primaryNounsDiffer(extractedName: string, matchedName: string): boolean {
  const extractedWords = new Set(extractedName.split(WORD_BREAK).map(singularize))
  const matchedWords = new Set(matchedName.toLowerCase().split(WORD_BREAK).map(singularize))
  // A word that never singularizes still matches its singular: "chive" and "chives" (HON-1559)
  const sameWord = (a: string, b: string) => a === b || pluralize(a) === b || pluralize(b) === a
  const lacks = (words: Set<string>, w: string) => ![...words].some((other) => sameWord(other, w))

  const extractedUnique = [...extractedWords].filter(
    (w) => lacks(matchedWords, w) && !COMMON_SUFFIXES.has(w),
  )
  const matchedUnique = [...matchedWords].filter(
    (w) => lacks(extractedWords, w) && !COMMON_SUFFIXES.has(w),
  )
  return extractedUnique.length > 0 && matchedUnique.length > 0
}

/**
 * Whether a qualified name matched only its bare last word: "walnut butter" against
 * `butter`. The noun check misses it, because the bare row has no word of its own.
 * The normalized name is singular, so the row's name is too: "wasabi peas" against
 * `peas` is the same guess.
 */
export function isBareLastWord(normalizedName: string, matchedName: string): boolean {
  const bareName = matchedName.toLowerCase().trim().split(/\s+/).map(singularize).join(' ')
  return bareName === extractLastWord(normalizedName)
}
