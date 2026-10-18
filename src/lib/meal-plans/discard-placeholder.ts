import { prisma } from '@/lib/prisma'

/**
 * Deletes a picker placeholder of a plan the household owns: an entry with no
 * meal and no note. An entry that has either is kept, because the discard the
 * picker sends as the page unloads can arrive after the pick it raced
 * (HON-1251). True when an entry was deleted.
 */
export async function discardPlaceholder(
  householdId: string,
  planId: string,
  entryId: string,
): Promise<boolean> {
  const { count } = await prisma.mealPlanEntry.deleteMany({
    where: { id: entryId, planId, plan: { householdId }, mealId: null, note: null },
  })
  return count > 0
}
