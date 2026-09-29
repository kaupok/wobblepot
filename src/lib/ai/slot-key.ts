import { toDateString } from '@/lib/meal-planning/dates'
import type { MealType } from '@/generated/prisma/enums'

/**
 * Stable key for a (date, mealType) slot. Lives on its own, away from the
 * Prisma-backed `./plan-helpers` that re-exports it, so the pure plan request
 * builder in `./prompts` can use it (HON-796).
 */
export function slotKey(date: Date | string, mealType: MealType | string): string {
  const dateStr = typeof date === 'string' ? date : toDateString(date)
  return `${dateStr}:${mealType}`
}
