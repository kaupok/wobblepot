/**
 * Why a household meal read or write was refused. The routes map each one to
 * its status:
 *
 * - `mealNotFound`: no such meal in this household (404). A library meal and
 *   another household's meal answer this too, and so does a deleted one on
 *   update and delete, and so does one deleted longer ago than the restore
 *   window on restore.
 * - `mealNotDeleted`: a restore names a live recipe (409, HON-1336).
 * - `ingredientsNotFound`: a component names an ingredient that does not
 *   exist or belongs to another household, so its id is not revealed (400,
 *   HON-889). `missingIds` names them.
 */
export type HouseholdMealRefusal = 'mealNotFound' | 'mealNotDeleted' | 'ingredientsNotFound'

export class HouseholdMealError extends Error {
  constructor(
    readonly reason: HouseholdMealRefusal,
    readonly missingIds: string[] = [],
  ) {
    super(`Household meal refused: ${reason}`)
    this.name = 'HouseholdMealError'
  }
}
