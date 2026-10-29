import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * The entry read that `POST .../entries/[entryId]/regenerate` and
 * `.../suggestions` share before they call `suggestForSlot` (HON-1206).
 * Tested against a database in `slot-context.db.test.ts`.
 */

/**
 * An entry of a plan the household owns, with the meal fields `swap` mode
 * ranks against. Null when no such entry exists, including when it belongs to
 * another household's plan.
 */
export function loadSlotEntry(householdId: string, planId: string, entryId: string) {
  return prisma.mealPlanEntry.findFirst({
    where: {
      id: entryId,
      planId,
      plan: { householdId },
    },
    select: {
      id: true,
      planId: true,
      date: true,
      mealType: true,
      mealId: true,
      meal: {
        select: {
          id: true,
          timeMinutes: true,
          primaryProteinType: true,
        },
      },
    },
  })
}
