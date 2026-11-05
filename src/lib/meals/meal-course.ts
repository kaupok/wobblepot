import 'server-only'

import type { MealCourse } from '@/generated/prisma/enums'
import { prisma } from '@/lib/prisma'

/**
 * Sets whether one of the household's own live recipes is a main or a side
 * dish (HON-1610). `create_meal` and `update_meal` write it next to the
 * recipe; the suggestion pools read it (HON-1608). A shared or deleted recipe
 * matches nothing.
 */
export async function setMealCourse(
  householdId: string,
  mealId: string,
  course: MealCourse,
): Promise<void> {
  await prisma.meal.updateMany({
    where: { id: mealId, householdId, deletedAt: null },
    data: { course },
  })
}
