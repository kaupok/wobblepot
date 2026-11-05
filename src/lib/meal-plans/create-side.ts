import 'server-only'

import { MealPlanEntryStatus } from '@/generated/prisma/enums'
import { getEffectiveServings, sumPortions } from '@/lib/meal-planning/servings'
import { prisma } from '@/lib/prisma'

/**
 * Why `createSide` refused a request (HON-1610):
 *
 * - `noMain`: the slot has no recipe or fridge meal to add a side to (Q3).
 * - `mainSkipped`: the slot was skipped (Q7).
 * - `alreadyInSlot`: the meal is the main or a side of the slot already (Q8).
 * - `mealNotFound`: the meal does not exist, is deleted, or is another
 *   household's.
 */
export type SideCreateRefusal = 'noMain' | 'mainSkipped' | 'alreadyInSlot' | 'mealNotFound'

export class SideCreateError extends Error {
  constructor(readonly reason: SideCreateRefusal) {
    super(`Side create refused: ${reason}`)
    this.name = 'SideCreateError'
  }
}

export interface NewSide {
  date: Date
  mealType: 'breakfast' | 'lunch' | 'dinner'
  mealId: string
  /** Null or absent: the side follows the main's own servings (Q2). */
  servingOverride?: number | null
  /** Undo after Remove brings the side's rating back (HON-1611). */
  rating?: 'up' | 'down' | null
  /**
   * Undo after Remove of a side that was not made (HON-1611): it comes back
   * skipped, whatever its main's status, and is never cooked or charged.
   */
  skipped?: boolean
}

/**
 * Adds a side to the main of a slot in a plan the household owns, and throws
 * `SideCreateError` for every refusal. A side of a planned main is planned,
 * on a past day too. A side of a completed main is saved as eaten, with its
 * cooked count and its pantry marker set, so the pantry never pays for it
 * (Q7, HON-651).
 */
export async function createSide(householdId: string, planId: string, input: NewSide) {
  return prisma.$transaction(async (tx) => {
    const main = await tx.mealPlanEntry.findFirst({
      where: {
        planId,
        plan: { householdId },
        date: input.date,
        mealType: input.mealType,
        mainEntryId: null,
      },
      select: {
        id: true,
        kind: true,
        mealId: true,
        status: true,
        servingOverride: true,
        sides: { select: { mealId: true } },
        plan: {
          select: {
            household: {
              select: {
                members: { select: { preferences: { select: { portionMultiplier: true } } } },
              },
            },
          },
        },
      },
    })

    if (!main || (main.kind === 'meal' && main.mealId === null)) {
      throw new SideCreateError('noMain')
    }
    if (main.status === MealPlanEntryStatus.skipped) {
      throw new SideCreateError('mainSkipped')
    }
    if (main.mealId === input.mealId || main.sides.some((side) => side.mealId === input.mealId)) {
      throw new SideCreateError('alreadyInSlot')
    }

    const meal = await tx.meal.findFirst({
      where: { id: input.mealId, deletedAt: null, OR: [{ householdId: null }, { householdId }] },
      select: { id: true },
    })
    if (!meal) throw new SideCreateError('mealNotFound')

    const servingOverride = input.servingOverride ?? null
    const servings = getEffectiveServings(
      { servingOverride, mainEntry: main },
      sumPortions(main.plan.household.members),
    )
    const completed = main.status === MealPlanEntryStatus.completed

    const side = await tx.mealPlanEntry.create({
      data: {
        planId,
        date: input.date,
        mealType: input.mealType,
        mainEntryId: main.id,
        mealId: input.mealId,
        servingOverride,
        rating: input.rating ?? null,
        status: input.skipped
          ? MealPlanEntryStatus.skipped
          : completed
            ? MealPlanEntryStatus.completed
            : MealPlanEntryStatus.planned,
        ...(completed &&
          !input.skipped && { cookedServings: servings, pantryDeductedAt: new Date() }),
      },
      select: { id: true, status: true },
    })

    return { id: side.id, mainEntryId: main.id, status: side.status, servings }
  })
}
