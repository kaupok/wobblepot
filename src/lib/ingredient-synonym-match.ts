import { INGREDIENT_SYNONYMS, synonymKey } from './ingredient-aliases'

/** Shorter terms match too many keys to be useful ("pe" → every pepper). */
export const MIN_SYNONYM_TERM_LENGTH = 3

/**
 * A shorter term that starts a one-word synonym is often a common word of its
 * own ("egg" starts "eggplant"), so it must not outrank the rows named by it
 * (HON-1104).
 */
export const MIN_STRONG_KEY_TERM_LENGTH = 4

export interface SynonymMatch {
  /** The global ingredient's name in the pool. */
  target: string
  /** The other English name the search term matched. */
  synonym: string
  /**
   * True when the term picks out this synonym rather than a generic word in
   * it: it starts a one-word synonym with at least `MIN_STRONG_KEY_TERM_LENGTH`
   * characters ("zucc", "ruta"), or it reaches past the first word of a longer
   * one ("all-purpose f"). False when it is a shorter start of a one-word
   * synonym ("egg" in "eggplant"), only the first word or part of it
   * ("all-purpose", "sweet") or starts a later word ("pepper" in "red bell
   * pepper"). The search route ranks only a strong hit above name hits.
   */
  strong: boolean
}

/**
 * The synonym keys a search term matches, one per target row (HON-1100).
 *
 * A key matches when it, or one of its words, starts with the term. Both are
 * compared by `synonymKey`, so case, hyphens and apostrophes do not matter:
 * "all-purpose fl", "all purpose fl" and "flo" all match "all-purpose flour".
 * When several keys point at one row, a strong match wins, then a key that
 * starts with the term, then a key whose later word does; table order breaks
 * ties.
 */
export function findSynonymMatches(search: string): SynonymMatch[] {
  const term = synonymKey(search)
  if (term.length < MIN_SYNONYM_TERM_LENGTH) return []

  const strong: SynonymMatch[] = []
  const byKeyStart: SynonymMatch[] = []
  const byWordStart: SynonymMatch[] = []
  for (const [synonym, target] of Object.entries(INGREDIENT_SYNONYMS)) {
    const key = synonymKey(synonym)
    const words = key.split(' ')
    // The first word as the table writes it: "all-purpose" is one word, so
    // typing "all purpose" is still only the first word.
    const tableWords = synonym.split(/\s+/)
    const firstWord = synonymKey(tableWords[0] ?? synonym)
    if (key.startsWith(term)) {
      const picksOut =
        tableWords.length === 1
          ? term.length >= MIN_STRONG_KEY_TERM_LENGTH
          : term.length > firstWord.length
      if (picksOut) {
        strong.push({ target, synonym, strong: true })
      } else {
        byKeyStart.push({ target, synonym, strong: false })
      }
    } else if (words.some((word) => word.startsWith(term))) {
      byWordStart.push({ target, synonym, strong: false })
    }
  }

  const matches = new Map<string, SynonymMatch>()
  for (const match of [...strong, ...byKeyStart, ...byWordStart]) {
    if (!matches.has(match.target)) matches.set(match.target, match)
  }
  return [...matches.values()]
}
