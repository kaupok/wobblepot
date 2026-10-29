import 'server-only'

import { Prisma } from '@/generated/prisma/client'
import { mealTranslationsInclude, translateMeal } from '@/lib/i18n/content'
import { visibleMealWhere } from '@/lib/meals/load-meals'
import { prisma } from '@/lib/prisma'

/**
 * A household's favourite meals, behind `POST` and `DELETE
 * /api/meals/[id]/favorite` (HON-1211). The route owns the session and the
 * household; these functions own every query, and are tested against a
 * database in `favorite.db.test.ts`.
 */

/**
 * Why a favourite change was refused. The route maps each one to its status:
 *
 * - `mealNotFound`: no such meal, a deleted one, or another household's (404).
 * - `alreadyFavorite`: the household already favourites the meal (409).
 * - `notFavorite`: the household does not favourite the meal (404).
 */
export type FavoriteRefusal = 'mealNotFound' | 'alreadyFavorite' | 'notFavorite'

export class FavoriteError extends Error {
  constructor(readonly reason: FavoriteRefusal) {
    super(`Favourite change refused: ${reason}`)
    this.name = 'FavoriteError'
  }
}

/** Marks a meal the household can see as one of its favourites. */
export async function addFavorite(householdId: string, mealId: string): Promise<{ id: string }> {
  const meal = await prisma.meal.findFirst({
    where: { id: mealId, ...visibleMealWhere(householdId) },
    select: { id: true },
  })
  if (!meal) throw new FavoriteError('mealNotFound')

  try {
    return await prisma.favoriteMeal.create({
      data: { householdId, mealId },
      select: { id: true },
    })
  } catch (error) {
    // `@@unique([householdId, mealId])`: the favourite exists already,
    // including one a concurrent request wrote first.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new FavoriteError('alreadyFavorite')
    }
    throw error
  }
}

/** Removes a meal from the household's favourites. */
export async function removeFavorite(householdId: string, mealId: string): Promise<void> {
  const { count } = await prisma.favoriteMeal.deleteMany({ where: { householdId, mealId } })
  if (count === 0) throw new FavoriteError('notFavorite')
}

/**
 * A meal the household can see, with its name in `locale`, or null when there
 * is no such meal, it is deleted, or it is another household's own recipe.
 * `removeFavorite` never checks the meal, so a caller that must refuse an
 * unknown meal reads it here first (HON-1333).
 */
export async function findVisibleMealName(
  householdId: string,
  mealId: string,
  locale: string,
): Promise<{ id: string; name: string } | null> {
  const meal = await prisma.meal.findFirst({
    where: { id: mealId, ...visibleMealWhere(householdId) },
    select: { id: true, name: true, ...mealTranslationsInclude(locale) },
  })
  if (!meal) return null
  const { id, name } = translateMeal(meal, locale)
  return { id, name }
}
