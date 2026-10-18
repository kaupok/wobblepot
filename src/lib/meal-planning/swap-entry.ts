import 'server-only'
import { prisma } from '@/lib/prisma'
import { MealPlanEntryStatus } from '@/generated/prisma/enums'
import type { Prisma } from '@/generated/prisma/client'

/**
 * The rules for pointing a plan entry at another meal, shared by
 * `PATCH /api/meal-plans/[id]/entries/[entryId]` and the MCP `swap_meal` tool
 * (HON-1174), so the two paths cannot drift.
 */

/**
 * The meal a swap points the entry at, with the components the pantry is
 * charged for when the entry is completed. Null when the meal does not exist,
 * is deleted, or belongs to another household.
 *
 * The visibility filter matters: without it a caller could attach another
 * household's custom meal to their entry, which the plan read then serialises
 * back to them in full, and whose components a deduction would charge their
 * pantry for. Same rule as `/api/meals/[id]/favorite`.
 */
export function findSwapMeal(householdId: string, mealId: string) {
  return prisma.meal.findFirst({
    where: {
      id: mealId,
      deletedAt: null,
      OR: [{ householdId: null }, { householdId }],
    },
    select: {
      id: true,
      components: {
        select: {
          ingredientId: true,
          quantityPerServing: true,
        },
      },
    },
  })
}

export interface SwapEntryData {
  mealId: string
  preparationTips?: null
  servingOverride?: null
  rating?: null
}

/**
 * The columns a swap writes. Everything besides `mealId` describes *the meal
 * that was on this entry*, so it is reset only when the entry is actually
 * repointed. `mealId` being present in a request is not the same as the meal
 * changing: `/regenerate` filters the planned meal out of its suggestions, but
 * search and "my recipes" browse go to `/api/meals` unfiltered
 * (`meal-selector/use-meal-alternatives.ts`), so the dish already on the entry
 * can be listed and clicked, and `MealSelectorModal.handleSelect` PATCHes
 * whatever row was selected. Re-selecting what is already planned changes
 * nothing and must cost nothing.
 *
 * Unguarded, that no-op write silently reverted a deliberate serving override
 * to the household size and bought a fresh tips generation, and, carrying
 * `status: 'completed'` + `deductPantry`, charged the pantry at the household
 * size for an entry stored at the override (HON-703).
 *
 * An explicit `servingOverride` or `rating` in the same request still wins:
 * the route applies those after this.
 */
export function swapEntryData(currentMealId: string | null, nextMealId: string): SwapEntryData {
  if (nextMealId === currentMealId) return { mealId: nextMealId }
  return {
    mealId: nextMealId,
    // Cached tips describe the previous meal, down to its equipment and
    // timings (HON-682).
    preparationTips: null,
    // The override was chosen for the previous meal; the incoming one starts
    // at the household's own size (HON-682).
    servingOverride: null,
    // A rating is a verdict on *the meal this entry points at*, so it does not
    // survive the entry being repointed. Left in place it is a thumbs-up the
    // household gave a dish they then replaced, now attached to one they have
    // said nothing about, reachable as complete → rate → revert to `planned`
    // (which still allows a swap, nothing having been charged) → swap. The
    // swap ranking reads ratings (HON-340), so a rating on the wrong meal
    // would steer what the household is offered (HON-703). Cleared rather
    // than refusing the swap: there is no pantry accounting to protect, so a
    // refusal would only block "we rated it, we changed our minds".
    //
    // This is also the one of the three that a mistaken reset cannot undo:
    // tips regenerate and an override can be re-entered, but only the
    // household can say again what they thought of the meal.
    rating: null,
  }
}

/**
 * Writes a swap that does not deduct the pantry, and returns the row, or null
 * when the entry was completed (or deleted) before the write landed.
 *
 * A completed entry records what was cooked and what the pantry was charged
 * for, so it is never repointed (HON-633). A caller's earlier status read is
 * stale by the time of this write: a concurrent request can commit
 * `completed` and charge the pantry for the meal the entry named then, and
 * the swap would repoint it at a different one. So the status is re-tested as
 * part of the write: `updateManyAndReturn` matches nothing if the entry
 * reached `completed` in the meantime, and still returns the row so a
 * response stays row-derived rather than reconstructed.
 */
export async function writeSwappedEntry(
  entryId: string,
  data: Prisma.MealPlanEntryUncheckedUpdateManyInput & { mealId: string },
) {
  return prisma
    .$transaction(async (tx) => {
      await clearChangesOnSwap(tx, entryId, data.mealId)
      const [swapped] = await tx.mealPlanEntry.updateManyAndReturn({
        where: { id: entryId, status: { not: MealPlanEntryStatus.completed } },
        data,
      })
      // Throwing rolls the cleared changes back with the refused swap.
      if (!swapped) throw new SwapRefused()
      return swapped
    })
    .catch((error: unknown) => {
      if (error instanceof SwapRefused) return null
      throw error
    })
}

class SwapRefused extends Error {}

/**
 * Deletes the entry's ingredient changes when a swap repoints it at another
 * meal (HON-1243). A change describes the meal it was made on — "yoghurt
 * instead of cream" — so on another meal it is either stale or, for an added
 * ingredient, silently wrong. A re-select of the same meal keeps them, as it
 * keeps the tips (`swapEntryData`). Call it in the swap's own transaction,
 * before the write that moves `mealId`: the filter reads the meal the entry
 * still points at.
 */
export function clearChangesOnSwap(
  tx: Prisma.TransactionClient,
  entryId: string,
  nextMealId: string,
) {
  return tx.mealPlanEntryComponent.deleteMany({
    where: { entryId, entry: { mealId: { not: nextMealId } } },
  })
}
