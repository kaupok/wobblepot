import { prisma } from '@/lib/prisma'

/**
 * Deletes a picker placeholder of a plan the household owns: an entry with no
 * meal, no note, and not a fridge meal (HON-1277). An entry with any is kept, because the discard the
 * picker sends as the page unloads can arrive after the pick it raced
 * (HON-1251). True when an entry was deleted.
 */
export async function discardPlaceholder(
  householdId: string,
  planId: string,
  entryId: string,
): Promise<boolean> {
  const { count } = await prisma.mealPlanEntry.deleteMany({
    where: { id: entryId, planId, plan: { householdId }, mealId: null, note: null, kind: 'meal' },
  })
  return count > 0
}
