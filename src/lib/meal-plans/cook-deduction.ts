import 'server-only'

import type { Prisma } from '@/generated/prisma/client'
import type { IngredientCategory, Unit } from '@/generated/prisma/enums'
import { defaultCookOutcome } from '@/lib/pantry/cook-outcome'

/**
 * The pantry writes of a cooked recipe meal, inside `updateEntry`'s
 * completion transaction (HON-625, HON-632, HON-1563).
 */

/** One component's charge, sorted by `compareIngredientIds`. */
export interface Deduction {
  ingredientId: string
  amount: number
}

/**
 * The cook's answer for each ingredient the meal touches (HON-1563,
 * HON-1583). `chargePantry` acts on these sets in its `where`, so no pantry
 * quantity is read first.
 */
export interface CookOutcomeSets {
  /** "Have some" rows (`quantity: null`) that go to `0`: the default when the cook sent no answer. */
  ranOut: ReadonlySet<string>
  /** Rows the cook named used up: `0`, whatever the quantity, with no decrement. */
  usedUp: ReadonlySet<string>
  /** Known rows the cook named some left: a decrement that empties or overshoots one gives `null`, "have some". */
  someLeft: ReadonlySet<string>
}

/**
 * Sort the meal's ingredients into `CookOutcomeSets`. With the cook's
 * `usedUpListed` sent, those ids are used up and every other null row keeps
 * its "have some"; without it, `defaultCookOutcome` picks the null rows the
 * meal ran out, and a known row only subtracts. An id in both lists is used
 * up. An id that is not one of `components` is never returned, so a
 * completion cannot zero the rest of the pantry.
 */
export function ranOutIngredientIds(
  components: readonly {
    ingredientId: string
    ingredient: { category: IngredientCategory; subcategory: string | null; defaultUnit: Unit }
  }[],
  deductions: readonly Deduction[],
  usedUpListed: readonly string[] | undefined,
  someLeftListed: readonly string[] | undefined = undefined,
): CookOutcomeSets {
  const usedUpIds = usedUpListed === undefined ? undefined : new Set(usedUpListed)
  const someLeftIds = new Set(someLeftListed)
  const ranOut = new Set<string>()
  const usedUp = new Set<string>()
  const someLeft = new Set<string>()
  for (const { ingredientId, ingredient } of components) {
    if (usedUpIds) {
      if (usedUpIds.has(ingredientId)) usedUp.add(ingredientId)
    } else if (
      defaultCookOutcome({
        pantryQuantity: null,
        isStaple: false,
        category: ingredient.category,
        subcategory: ingredient.subcategory,
        defaultUnit: ingredient.defaultUnit,
        amountUsed: deductions
          .filter((d) => d.ingredientId === ingredientId)
          .reduce((sum, d) => sum + d.amount, 0),
      }) === 'usedUp'
    ) {
      ranOut.add(ingredientId)
    }
    if (someLeftIds.has(ingredientId) && !usedUp.has(ingredientId)) someLeft.add(ingredientId)
  }
  return { ranOut, usedUp, someLeft }
}

/**
 * Charge the pantry one row at a time, in the sorted order of `deductions`,
 * and finish with a row before moving to the next, by the cook's answer in
 * `outcomes` (`ranOutIngredientIds`).
 */
export async function chargePantry(
  tx: Prisma.TransactionClient,
  householdId: string,
  deductions: readonly Deduction[],
  outcomes: CookOutcomeSets,
): Promise<void> {
  // The one-pass shape is what makes the sort worth anything. Splitting
  // the work into "every decrement, then every write to 0" sorts each pass
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
  // Grouping by ingredient also writes 0 once for a meal that lists the
  // same ingredient in two components, and a `Map` iterates in insertion
  // order, so building it from the sorted `deductions` keeps the order.
  const deductionsByIngredientId = new Map<string, number[]>()
  for (const { ingredientId, amount } of deductions) {
    const amounts = deductionsByIngredientId.get(ingredientId)
    if (amounts) amounts.push(amount)
    else deductionsByIngredientId.set(ingredientId, [amount])
  }

  for (const [ingredientId, amounts] of deductionsByIngredientId) {
    // A row the cook named used up reads `0`, "ran out", whatever it held:
    // one write, with no decrement first, and no `quantity` filter, so a
    // known amount and a "have some" row both get there.
    if (outcomes.usedUp.has(ingredientId)) {
      await tx.pantryItem.updateMany({
        where: { householdId, ingredientId, isStaple: false },
        data: { quantity: 0 },
      })
      continue
    }

    // `householdId` + `ingredientId` is unique, so this matches at most
    // one row; `updateMany` (rather than `update`) is what makes an
    // ingredient the household has no pantry row for a no-op instead of
    // a throw. Staples are exempt from deduction, and a null quantity
    // means "some, amount unknown" — there is nothing to subtract from,
    // so both are filtered out here and the null rows are handled by the
    // write below.
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

    // A row the deduction emptied or overshot reads `0`, "ran out"
    // (HON-1399), and stays in the pantry's Ran out group — unless the cook
    // said some is left, when it reads `null`, "have some", because the
    // amount left is unknown. This still runs after the decrements it is
    // judging — just this row's, which are the only writes that can change
    // it — so it needs no application-side read. A row the deduction
    // overshot is briefly negative, but never outside this transaction. A
    // "have some" row the meal ran out goes to `0` too; one with some left
    // stays as it is.
    //
    // One statement per row, never an update over an `IN` list: a
    // multi-row write lets Postgres pick its own scan order, which is the
    // ordering the sort exists to remove.
    if (outcomes.someLeft.has(ingredientId)) {
      await tx.pantryItem.updateMany({
        where: { householdId, ingredientId, isStaple: false, quantity: { lte: 0 } },
        data: { quantity: null },
      })
      continue
    }
    await tx.pantryItem.updateMany({
      where: {
        householdId,
        ingredientId,
        isStaple: false,
        OR: outcomes.ranOut.has(ingredientId)
          ? [{ quantity: null }, { quantity: { lte: 0 } }]
          : [{ quantity: { lte: 0 } }],
      },
      data: { quantity: 0 },
    })
  }
}
