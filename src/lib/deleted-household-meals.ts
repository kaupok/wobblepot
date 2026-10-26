import 'server-only'
import { prisma } from '@/lib/prisma'
import { HouseholdMealError } from '@/lib/household-meals'

/**
 * A household's deleted recipes (HON-1336). A delete only sets `deletedAt`, so
 * for `RECIPE_RESTORE_WINDOW_DAYS` the household can bring the recipe back
 * with its image, ingredients and history. After that the restore route
 * answers 404 and the purge cron clears the image
 * (`purgeExpiredDeletedMealImages`). The routes own the session and the
 * membership; these functions own the queries, tested in
 * `deleted-household-meals.db.test.ts`.
 */

/** The account-deletion grace window (HON-481), so a household learns one rule. */
export const RECIPE_RESTORE_WINDOW_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/** The oldest `deletedAt` a restore still accepts at `now`. */
export function restoreWindowStart(now: Date): Date {
  return new Date(now.getTime() - RECIPE_RESTORE_WINDOW_DAYS * DAY_MS)
}

/** The household's recipes deleted within the restore window, newest first. */
export async function listRecentlyDeletedHouseholdMeals(householdId: string, now = new Date()) {
  const meals = await prisma.meal.findMany({
    where: { householdId, deletedAt: { gte: restoreWindowStart(now) } },
    select: { id: true, name: true, deletedAt: true },
    orderBy: [{ deletedAt: 'desc' }, { id: 'asc' }],
  })

  // The filter excludes null, but Prisma still types the column as nullable.
  return meals.map((meal) => ({ ...meal, deletedAt: meal.deletedAt as Date }))
}

/**
 * Bring back one of the household's recipes deleted within the restore
 * window. Answers `mealNotFound` for a recipe that is another household's, a
 * library one, unknown, or deleted before the window, and `mealNotDeleted`
 * for a live one. A live recipe with the same name does not block it, since
 * the edit form allows two recipes with one name. Answers with the recipe's
 * id and name, for `restore_meal` (HON-1337).
 */
export async function restoreHouseholdMeal(householdId: string, id: string, now = new Date()) {
  const meal = await prisma.meal.findFirst({
    where: { id, householdId },
    select: { name: true, deletedAt: true },
  })

  if (!meal) throw new HouseholdMealError('mealNotFound')
  if (!meal.deletedAt) throw new HouseholdMealError('mealNotDeleted')
  if (meal.deletedAt < restoreWindowStart(now)) throw new HouseholdMealError('mealNotFound')

  await prisma.meal.update({ where: { id }, data: { deletedAt: null } })
  return { id, name: meal.name }
}
