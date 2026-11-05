// The body `updateEntry` (`entries.ts`) applies, split out for the file-size
// cap (HON-1611). The route validates it; the slot rules read it too.

/** The validated body of an entry update. A key that is present but null clears the field. */
export interface EntryPatch {
  status?: 'planned' | 'completed' | 'skipped'
  mealId?: string
  deductPantry?: boolean
  note?: string | null
  noteX?: number | null
  noteY?: number | null
  servingOverride?: number | null
  rating?: 'up' | 'down' | null
  /**
   * The pantry items the household used up: a fridge meal's (HON-1277), or
   * the "have some" rows a cooked recipe meal ran out (HON-1563). On a recipe
   * meal, a row in none of the three lists takes `defaultCookOutcome`
   * (HON-1582), so a caller names every row it asked about. It can
   * name a known-amount row too, which goes to `0` with no decrement
   * (HON-1583).
   */
  usedUpIngredientIds?: string[]
  /**
   * The rows a cooked recipe meal left some of: a decrement that empties or
   * overshoots a known-amount one gives "have some" (`null`), not `0`
   * (HON-1583), and a running-low mark clears, staples included (HON-1592).
   */
  someLeftIngredientIds?: string[]
  /**
   * The rows a cooked recipe meal left running low (HON-1588): each keeps
   * what the subtraction leaves and gets `lowAt`, and one the subtraction
   * emptied reads "have some". A staple is never subtracted, so it only gets
   * `lowAt`. A staple in `usedUpIngredientIds` goes to `0`.
   */
  lowIngredientIds?: string[]
  /**
   * The planned sides a Cooked on their main did not make (HON-1611): they
   * are skipped in the completion's transaction and not charged. Ignored on
   * an entry with no sides.
   */
  skippedSideIds?: string[]
}
