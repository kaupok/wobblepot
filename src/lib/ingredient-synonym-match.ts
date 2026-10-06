import { INGREDIENT_SYNONYMS } from './ingredient-aliases'

/** Shorter terms match too many keys to be useful ("pe" → every pepper). */
export const MIN_SYNONYM_TERM_LENGTH = 3

export interface SynonymMatch {
  /** The global ingredient's name in the pool. */
  target: string
  /** The other English name the search term matched. */
  synonym: string
  /**
   * True when the whole synonym starts with the term ("plain fl"), false when
   * only a later word does ("pepper" in "red pepper"). The search route ranks
   * only the first kind as a strong hit.
   */
  byKeyStart: boolean
}

/**
 * The synonym keys a search term matches, one per target row (HON-1100).
 *
 * A key matches when it, or one of its words, starts with the term
 * (case-insensitive): "plain fl" and "flo" both match "plain flour". When
 * several keys point at one row, a key that starts with the term wins over a
 * key whose later word does, then table order decides.
 */
export function findSynonymMatches(search: string): SynonymMatch[] {
  const term = search.trim().toLowerCase()
  if (term.length < MIN_SYNONYM_TERM_LENGTH) return []

  const byKeyStart: SynonymMatch[] = []
  const byWordStart: SynonymMatch[] = []
  for (const [synonym, target] of Object.entries(INGREDIENT_SYNONYMS)) {
    if (synonym.startsWith(term)) {
      byKeyStart.push({ target, synonym, byKeyStart: true })
    } else if (synonym.split(/\s+/).some((word) => word.startsWith(term))) {
      byWordStart.push({ target, synonym, byKeyStart: false })
    }
  }

  const matches = new Map<string, SynonymMatch>()
  for (const match of [...byKeyStart, ...byWordStart]) {
    if (!matches.has(match.target)) matches.set(match.target, match)
  }
  return [...matches.values()]
}
