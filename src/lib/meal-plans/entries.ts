import 'server-only'
import { prisma } from '@/lib/prisma'
import { MealPlanEntryStatus, EntryRating } from '@/generated/prisma/enums'
import { getEffectiveServings, sumPortions } from '@/lib/meal-planning/servings'
import { compareIngredientIds } from '@/lib/meal-planning/pantry'
import { findSwapMeal, swapEntryData, writeSwappedEntry } from '@/lib/meal-planning/swap-entry'

/**
 * Persistence and rules for one meal plan entry, behind
 * `PATCH` and `DELETE /api/meal-plans/[id]/entries/[entryId]` (HON-1189).
 * The route owns the session, the household, and body validation; these
 * functions own every query, and are tested against a database in
 * `entries.db.test.ts`.
 */

/**
 * Why `updateEntry` refused a request. The route maps each one to its status:
 *
 * - `entryNotFound`: no such entry in this plan of this household (404).
 * - `mealNotFound`: the swap target does not exist or is not visible to the
 *   household (404).
 * - `noFields`: the patch changes nothing (400).
 * - `completedSwap`: a swap on a completed entry, or one that lost the race
 *   to a completion (409, HON-633).
 * - `completedServings`: a serving-count change on a completed entry, or one
 *   that lost the race to a completion (409, HON-652).
 * - `staleMeal`: a completion whose meal or count moved underneath it; the
 *   claim was rolled back, so a retry is safe (409).
 * - `noNote`: a note place for an entry without a note (409, HON-975).
 */
export type EntryUpdateRefusal =
  | 'entryNotFound'
  | 'mealNotFound'
  | 'noFields'
  | 'completedSwap'
  | 'completedServings'
  | 'staleMeal'
  | 'noNote'

/**
 * A refusal from `updateEntry`. Thrown rather than returned because several
 * of them are raised inside the deduction's interactive transaction, where
 * throwing is the only way to roll the whole thing back.
 */
export class EntryUpdateError extends Error {
  constructor(readonly reason: EntryUpdateRefusal) {
    super(`Entry update refused: ${reason}`)
    this.name = 'EntryUpdateError'
  }
}

/** The validated body of an entry update. A key that is present but null clears the field. */
export interface EntryPatch {
  status?: 'planned' | 'completed' | 'skipped'
  mealId?: string
  deductPantry?: boolean
  note?: string | null
  noteX?: number | null
  noteY?: number | null
  servingOverride?: number | null
  rating?: 'up' | 'down' | null
}

/** What the route sends back after an update. */
export interface UpdatedEntry {
  id: string
  status: MealPlanEntryStatus | undefined
  mealId: string | null
  rating: EntryRating | null | undefined
  /** Present only when the request asked to complete with a deduction. */
  pantryDeducted?: boolean
}

/**
 * The write-time form of the rule that a completed entry's servings are
 * frozen: the row matches while it is not `completed`, or while its stored
 * override already equals the one being written. Re-tested inside the write
 * because the `status` read at the top of `updateEntry` can be stale by then.
 */
const servingsWritableWhere = (servingOverride: number | null) => ({
  OR: [{ status: { not: MealPlanEntryStatus.completed } }, { servingOverride }],
})

/**
 * Deletes an entry of a plan the household owns. False when no such entry
 * exists, including when it belongs to another household's plan.
 */
export async function deleteEntry(
  householdId: string,
  planId: string,
  entryId: string,
): Promise<boolean> {
  const { count } = await prisma.mealPlanEntry.deleteMany({
    where: { id: entryId, planId, plan: { householdId } },
  })
  return count > 0
}

/**
 * Applies a validated patch to an entry of a plan the household owns, and
 * charges the pantry when the patch completes the entry with `deductPantry`.
 * Throws `EntryUpdateError` for every refusal.
 */
export async function updateEntry(
  householdId: string,
  planId: string,
  entryId: string,
  patch: EntryPatch,
): Promise<UpdatedEntry> {
  // Include meal components for pantry deduction
  const entry = await prisma.mealPlanEntry.findFirst({
    where: {
      id: entryId,
      planId,
      plan: { householdId },
    },
    select: {
      id: true,
      mealId: true,
      status: true,
      servingOverride: true,
      pantryDeductedAt: true,
      note: true,
      plan: {
        select: {
          household: {
            select: {
              members: {
                select: { preferences: { select: { portionMultiplier: true } } },
              },
            },
          },
        },
      },
      meal: {
        select: {
          components: {
            select: {
              ingredientId: true,
              quantityPerServing: true,
            },
          },
        },
      },
    },
  })

  if (!entry) {
    throw new EntryUpdateError('entryNotFound')
  }

  // A completed entry records what was cooked and what the pantry was
  // charged for, so it cannot be repointed at a different meal afterwards.
  // The deduction guard below refuses to charge an already-completed entry a
  // second time, so writing `mealId` anyway would leave the entry naming one
  // meal while the pantry paid for another — HON-622's invariant reached
  // from the other side (HON-633). Refused whatever else the patch carries:
  // `status` and `deductPantry` cannot rescue the swap, because neither one
  // makes the deduction run. Reverting to `planned` first and swapping then
  // is still allowed, and still does not restock.
  //
  // This is the cheap answer for an entry that is *already* completed, not
  // the whole rule: `entry.status` was read outside any transaction, so a
  // swap that races a concurrent completion still passes here. Each of the
  // two writes below re-tests the status as part of the write itself, which
  // is what actually closes it.
  if (patch.mealId && entry.status === MealPlanEntryStatus.completed) {
    throw new EntryUpdateError('completedSwap')
  }

  // Same record, the other dimension: `mealId` is which components the
  // pantry was charged for, `servingOverride` is how many servings it was
  // charged at. Changing the count afterwards leaves the entry recording 6
  // while the pantry paid for 4, and nothing reconciles them (HON-652).
  //
  // Refused whatever `status` the patch carries. `status: 'completed'` on a
  // non-completed entry is the "complete for N servings" path and never
  // reaches this branch; on an entry that is *already* completed it is a
  // re-complete with a new count, which charges nothing either. Resending
  // the stored value is a no-op and passes. Reverting to `planned` first
  // unlocks the count.
  //
  // As with the swap guard, the status here was read outside any
  // transaction; the writes below re-test it via `servingsWritableWhere`.
  if (
    'servingOverride' in patch &&
    entry.status === MealPlanEntryStatus.completed &&
    (patch.servingOverride ?? null) !== entry.servingOverride
  ) {
    throw new EntryUpdateError('completedServings')
  }

  // Build update data
  const updateData: {
    status?: MealPlanEntryStatus
    mealId?: string
    preparationTips?: null
    note?: string | null
    noteX?: number | null
    noteY?: number | null
    servingOverride?: number | null
    rating?: EntryRating | null
  } = {}

  if (patch.status) {
    updateData.status = patch.status as MealPlanEntryStatus

    // Leaving `completed` re-opens an entry the membership invalidation
    // deliberately skipped: `invalidateFutureEntrySteps` carries
    // `status: { not: 'completed' }` because nulling the tips on a dinner
    // already eaten only buys a paid regeneration nobody reads (HON-684).
    // That trade holds only while the entry stays completed. Come back to a
    // cookable status and the cached tips may be priced at household servings
    // the household no longer has, with nothing left to clear them — the next
    // membership or portion change is the rare event this whole invalidation
    // is about.
    // So drop them on the way out of `completed`, the same shape as the swap
    // and `servingOverride` writers below.
    if (entry.status === MealPlanEntryStatus.completed && patch.status !== 'completed') {
      updateData.preparationTips = null
    }
  }

  // Components of the meal this request swaps to, if it swaps at all. The
  // pantry deduction below has to charge for what gets cooked, and on a swap
  // that is the incoming meal — not the one `entry` was read with.
  let swapMealComponents: { ingredientId: string; quantityPerServing: number }[] | undefined

  if (patch.mealId) {
    // Visible to this household only: see `findSwapMeal`.
    const meal = await findSwapMeal(householdId, patch.mealId)

    if (!meal) {
      throw new EntryUpdateError('mealNotFound')
    }

    swapMealComponents = meal.components
    // The tips, override and rating describe the previous meal, so they are
    // reset when the meal actually changes, and only then (HON-682,
    // HON-703). An explicit `servingOverride` or `rating` in the same
    // request is applied below and wins. A re-select carries no
    // `servingOverride` key at all, which matters: `effectiveServings` below
    // keys off `'servingOverride' in updateData`.
    Object.assign(updateData, swapEntryData(entry.mealId, patch.mealId))
  }

  // Handle note updates (including explicit null to clear)
  if ('note' in patch) {
    updateData.note = patch.note ?? null
    // The place belongs to the note: a note cleared and added again starts
    // at the default place (HON-975).
    if (updateData.note === null) {
      updateData.noteX = null
      updateData.noteY = null
    }
  }

  // The note's place on the planner card (HON-975). Only a note has one: a
  // slip dragged while another member cleared the note would otherwise leave
  // a place for the next note to inherit.
  if ('noteX' in patch) {
    const noteX = patch.noteX ?? null
    const noteY = patch.noteY ?? null
    if (noteX !== null && (updateData.note ?? entry.note) == null) {
      throw new EntryUpdateError('noNote')
    }
    updateData.noteX = noteX
    updateData.noteY = noteY
  }

  // Handle servingOverride updates (including explicit null to reset to household default)
  if ('servingOverride' in patch) {
    updateData.servingOverride = patch.servingOverride ?? null

    // The effective serving count is an input to the cached prep tips —
    // HON-614 made the prompt scale by it precisely because the tips are
    // cached per entry — so a dinner re-planned from 6 servings to 2 would
    // otherwise keep pan sizes and timings for 6. Invalidate here for the
    // same reason `PATCH /api/households/me` invalidates on a locale change
    // (HON-681, and the AI-cache rule in `docs/LOCALIZATION.md`).
    //
    // Only on a real change: resending the stored count is a no-op write and
    // must not throw away tips. `null` counts as a change when an override
    // was stored — the meal reverts to the household's own size.
    if (updateData.servingOverride !== entry.servingOverride) {
      updateData.preparationTips = null
    }
  }

  // Handle rating updates (including explicit null to clear)
  if ('rating' in patch) {
    updateData.rating = (patch.rating as EntryRating) ?? null
  }

  // Require at least one field to update
  if (Object.keys(updateData).length === 0) {
    throw new EntryUpdateError('noFields')
  }

  // Deduct the components of the meal this request persists. On a swap the
  // entry ends up pointing at the incoming meal, so charging the household
  // for `entry.meal` would take ingredients it never cooked and leave the
  // ones it did cook in the pantry (HON-622).
  const componentsToDeduct = swapMealComponents ?? entry.meal?.components ?? []

  // Handle pantry deduction when marking as completed. Deduction is a
  // relative decrement and is not idempotent, so an entry is charged at most
  // once in its life, and `pantryDeductedAt` is the stored fact that says it
  // was. The completion transaction below sets it in the same statement that
  // claims the entry, and **nothing clears it**:
  //
  // - Not a revert. Reverting to `planned` does not restock — the food was
  //   cooked — so complete → planned → complete must not charge the pantry
  //   a second time (HON-651). The stored status alone cannot see that round
  //   trip; the marker can.
  // - Not a swap after a revert. The original meal's ingredients were
  //   consumed, so charging the incoming meal on re-completion would be the
  //   same double-charge from another door.
  //
  // The status check stays alongside it. A repeated `completed` — a double
  // submit, a client retry — on an entry that was completed without
  // deducting has no marker, and must still not start charging a completed
  // entry: HON-633's rule that a completed entry is never repointed relies
  // on the claim refusing completed rows.
  const shouldDeductPantry =
    patch.deductPantry === true &&
    patch.status === 'completed' &&
    entry.status !== MealPlanEntryStatus.completed &&
    entry.pantryDeductedAt === null &&
    componentsToDeduct.length > 0

  if (shouldDeductPantry) {
    // The members' portions, not their count: a toddler at 0.5× eats half
    // of what an adult does, so the pantry loses half as much (HON-1040).
    const householdServings = sumPortions(entry.plan.household.members)
    // Scale by what this request persists, not by the row read at the top:
    // the route accepts `servingOverride` alongside `status: 'completed'` +
    // `deductPantry`, and a meal swap resets the override to null — either
    // way `entry.servingOverride` is already stale by the time the
    // transaction below runs.
    const effectiveServings = getEffectiveServings(
      'servingOverride' in updateData
        ? { servingOverride: updateData.servingOverride ?? null }
        : entry,
      householdServings,
    )
    // How much of each ingredient this meal consumes. The database applies
    // these as relative decrements — nothing here reads a pantry quantity,
    // because reading one is what used to lose deductions: two entries
    // sharing an ingredient and completed at the same moment both read the
    // same starting quantity and the second write overwrote the first
    // (1000g, −300g and −200g, left the pantry at 800g instead of 500g).
    // `decrement` makes the two compose (HON-625).
    const deductions = componentsToDeduct
      .map((component) => ({
        ingredientId: component.ingredientId,
        amount: component.quantityPerServing * effectiveServings,
      }))
      // Take the pantry row locks in a deterministic order. `meal.components`
      // is selected without an `orderBy`, so two meals sharing ingredients
      // can list them in opposite orders — and two completions locking the
      // same rows in opposite orders deadlock (Postgres 40P01), which rolls
      // the whole completion back and answers 500. The comparator is shared
      // with the two purchase routes, which take the same locks from the
      // other side; see its doc comment for why the comparison is by code
      // unit and not `localeCompare` (HON-632).
      .sort((a, b) => compareIngredientIds(a.ingredientId, b.ingredientId))

    const pantryDeducted = await prisma.$transaction(async (tx) => {
      // Claim the completion, and let the database decide who won. The
      // `status` and `pantryDeductedAt` this guards on were read at the top
      // of the function, outside any transaction, so `shouldDeductPantry`
      // alone cannot keep two concurrent completions of the *same* entry (a
      // double submit, two tabs, a client retry) from both passing it and
      // both deducting — charging the pantry twice for one cooked meal.
      // Re-testing both here as a conditional write makes it a no-op for the
      // loser: it takes the entry's row lock, so the second transaction only
      // proceeds once the first has committed `completed` and the marker.
      //
      // The marker is written by this same statement, so it commits exactly
      // when the decrements below do — every throw after it rolls both back
      // together (HON-651).
      //
      // `updateManyAndReturn` rather than `updateMany`: the row it hands
      // back is what the mealId check below reads. Claiming on the guard's
      // conditions alone and inspecting afterwards keeps
      // `claimed === undefined` meaning exactly one thing — nobody to claim
      // from — so the branch under it stays the lost-completion branch it was
      // written as.
      const [claimed] = await tx.mealPlanEntry.updateManyAndReturn({
        where: {
          id: entryId,
          status: { not: MealPlanEntryStatus.completed },
          pantryDeductedAt: null,
        },
        data: { ...updateData, pantryDeductedAt: new Date() },
      })

      if (!claimed) {
        // No row matched, which means a concurrent request charged this
        // entry first — by completing it, or by a complete-then-revert that
        // committed in between — or the entry has since been deleted
        // (`deleteEntry` races this one).
        //
        // A swap cannot be persisted from here. This request charges
        // nothing, so writing `mealId` would leave the entry naming a meal
        // the pantry was never charged for — the same hole the serial guard
        // at the top of the function closes, reached by losing the race
        // instead of by reading `completed` (HON-633). Throwing rolls the
        // transaction back, so nothing at all is written.
        //
        // The deleted-entry sub-case answers 409 too, not 404: this branch
        // cannot tell the two apart without another read, and "the entry is
        // no longer in a state that accepts this swap" is true of both. So
        // does the round-trip sub-case, where the entry is back in `planned`
        // with the marker set and a swap would in fact be allowed: refusing
        // writes nothing, and a retry reads the marker at the top and takes
        // the non-deducting swap path.
        if (updateData.mealId) {
          throw new EntryUpdateError('completedSwap')
        }

        // Without a swap, persist the rest of the update but charge nothing
        // — exactly what this request would have done had it arrived after
        // the winner committed and read `completed` at the top. `updateMany`
        // again rather than `update`: on the deleted-entry branch there is
        // no row to write, and `update` would throw P2025 and turn a lost
        // race into a 500.
        //
        // A serving count is the exception, for the swap's reason: the
        // winner charged the pantry at *its* count, so persisting a
        // different one here would leave the two disagreeing (HON-652). The
        // conditional write matches nothing in exactly that case, and
        // throwing rolls back everything else this request carries. A
        // deleted entry also matches nothing and answers 409 as well, the
        // same trade the swap branch above makes.
        if ('servingOverride' in updateData) {
          const { count } = await tx.mealPlanEntry.updateMany({
            where: {
              id: entryId,
              ...servingsWritableWhere(updateData.servingOverride ?? null),
            },
            data: updateData,
          })
          if (count === 0) {
            throw new EntryUpdateError('completedServings')
          }
          return false
        }

        await tx.mealPlanEntry.updateMany({ where: { id: entryId }, data: updateData })
        return false
      }

      // The claim won — but check what it won on. `deductions` was computed
      // from the components read at the top of the function, so a swap that
      // committed in between leaves this transaction holding a row that
      // names a different meal from the one it priced. Charging anyway takes
      // food that was never cooked; completing without charging silently
      // under-charges a meal the user did cook. Neither is acceptable, so
      // roll the completion back and let the caller retry against the meal
      // that is actually there (HON-633).
      //
      // Nothing has been deducted at this point, so the throw undoes only
      // the claim itself. A swap-and-complete is exempt: it prices the
      // incoming meal, which does not depend on what the entry pointed at.
      if (!updateData.mealId && claimed.mealId !== entry.mealId) {
        throw new EntryUpdateError('staleMeal')
      }

      // Same check for the count. Without `servingOverride` in this request
      // the deduction was priced at the count read at the top of the
      // function, so a servings change that committed in between would
      // complete the entry at one count while the pantry is charged for
      // another — and a completed entry's count is frozen, so nothing could
      // reconcile them afterwards (HON-652). A request that sends the count
      // (a swap resets it to null) prices what it persists and is exempt.
      if (!('servingOverride' in updateData) && claimed.servingOverride !== entry.servingOverride) {
        throw new EntryUpdateError('staleMeal')
      }

      // Charge the pantry one row at a time, in the sorted order above, and
      // finish with a row before moving to the next.
      //
      // The one-pass shape is what makes the sort worth anything. Splitting
      // the work into "every decrement, then every sweep" sorts each pass
      // but not their concatenation: the decrement filters
      // `quantity: { not: null }`, so a `quantity: null` row matches nothing
      // and takes no lock in the first pass — it is locked in the second,
      // after every quantified row is already held. With `ing-apple` at
      // `quantity: null` and `ing-beef` at 500, that completion locks beef
      // then apple, while a concurrent bulk purchase over the same two locks
      // apple then beef, and the two deadlock (Postgres 40P01) — the failure
      // HON-632 exists to remove, on exactly the rows the purchase routes
      // create (`quantity: null` is the state they insert).
      //
      // Grouping by ingredient also sweeps once for a meal that lists the
      // same ingredient in two components, and a `Map` iterates in insertion
      // order, so building it from the sorted `deductions` keeps the order.
      const deductionsByIngredientId = new Map<string, number[]>()
      for (const { ingredientId, amount } of deductions) {
        const amounts = deductionsByIngredientId.get(ingredientId)
        if (amounts) amounts.push(amount)
        else deductionsByIngredientId.set(ingredientId, [amount])
      }

      for (const [ingredientId, amounts] of deductionsByIngredientId) {
        // `householdId` + `ingredientId` is unique, so this matches at most
        // one row; `updateMany` (rather than `update`) is what makes an
        // ingredient the household has no pantry row for a no-op instead of
        // a throw. Staples are exempt from deduction, and a null quantity
        // means "some, amount unknown" — there is nothing to subtract from,
        // so both are filtered out here and the null rows are handled by the
        // sweep below.
        for (const amount of amounts) {
          await tx.pantryItem.updateMany({
            where: {
              householdId,
              ingredientId,
              isStaple: false,
              quantity: { not: null },
            },
            data: { quantity: { decrement: amount } },
          })
        }

        // Clear the row out if the deduction emptied it. This still runs
        // after the decrements it is judging — just this row's, which are
        // the only writes that can change it — so depletion is evaluated
        // against the post-decrement quantity without the application-side
        // read that used to lose deductions. A row the deduction overshot is
        // briefly negative, but never outside this transaction. Unquantified
        // rows (`quantity: null`) are consumed in full by cooking with them,
        // so they go too.
        //
        // One statement per row, never a `deleteMany` over an `IN` list: a
        // multi-row DELETE lets Postgres pick its own scan order, which is
        // the ordering the sort exists to remove.
        await tx.pantryItem.deleteMany({
          where: {
            householdId,
            ingredientId,
            isStaple: false,
            OR: [{ quantity: null }, { quantity: { lte: 0 } }],
          },
        })
      }

      return true
    })

    return {
      id: entryId,
      status: updateData.status,
      mealId: updateData.mealId ?? entry.mealId,
      rating: updateData.rating,
      pantryDeducted,
    }
  }

  // A swap that does not deduct — `{ mealId }` on its own, which is exactly
  // what `MealSelectorModal` sends and therefore the shape almost every real
  // swap takes. It never enters the transaction above (`shouldDeductPantry`
  // needs `status: 'completed'` *and* `deductPantry`), so the conditional
  // claim there does not cover it, and the guard at the top tested a
  // `status` read from before the meal lookup. Between that read and this
  // write a concurrent request can commit `completed` and charge the pantry
  // for the meal the entry named then — and this write would repoint the
  // entry at a different one (HON-633). `writeSwappedEntry` re-tests the
  // status as part of the write.
  if (updateData.mealId) {
    const swapped = await writeSwappedEntry(entryId, { ...updateData, mealId: updateData.mealId })

    if (!swapped) {
      throw new EntryUpdateError('completedSwap')
    }

    return toUpdatedEntry(swapped)
  }

  // A serving-count change that does not deduct. The guard at the top
  // refused it on an entry read as `completed`, but that read is from before
  // this write: a concurrent completion can commit in between and charge the
  // pantry at the old count. Re-test as part of the write, as the swap above
  // does — the row matches only while it is not `completed`, or while its
  // stored count already equals this one (HON-652).
  if ('servingOverride' in updateData) {
    const [updated] = await prisma.mealPlanEntry.updateManyAndReturn({
      where: { id: entryId, ...servingsWritableWhere(updateData.servingOverride ?? null) },
      data: updateData,
    })

    if (!updated) {
      throw new EntryUpdateError('completedServings')
    }

    return toUpdatedEntry(updated)
  }

  // Standard update without pantry deduction. No `mealId` and no
  // `servingOverride`, so neither of the rules above applies: note, rating
  // and status edits are safe on a completed entry.
  // A place for the note the entry holds now, re-tested in the write: the
  // read above is stale by the time a concurrent clear has committed, and
  // a place written after it would be inherited by the next note (HON-975).
  if (updateData.noteX != null && !('note' in updateData)) {
    const [placed] = await prisma.mealPlanEntry.updateManyAndReturn({
      where: { id: entryId, note: { not: null } },
      data: updateData,
    })

    if (!placed) {
      throw new EntryUpdateError('noNote')
    }

    return toUpdatedEntry(placed)
  }

  const updatedEntry = await prisma.mealPlanEntry.update({
    where: { id: entryId },
    data: updateData,
  })

  return toUpdatedEntry(updatedEntry)
}

function toUpdatedEntry(row: {
  id: string
  status: MealPlanEntryStatus
  mealId: string | null
  rating: EntryRating | null
}): UpdatedEntry {
  return { id: row.id, status: row.status, mealId: row.mealId, rating: row.rating }
}
