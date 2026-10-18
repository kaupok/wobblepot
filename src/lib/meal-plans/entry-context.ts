import 'server-only'
import { prisma } from '@/lib/prisma'
import { ingredientTranslationsInclude, mealTranslationsInclude } from '@/lib/i18n/content'
import { serializePreparationSteps } from '@/lib/preparation-steps'
import { applyEntryChanges, changeSetKey } from '@/lib/meal-planning/entry-components'
import type { Prisma } from '@/generated/prisma/client'
import type { PreparationSteps } from '@/components/meal-plan/types'

/**
 * The reads and the write that `POST .../entries/[entryId]/cook-question` and
 * `.../preparation-tips` make around their AI calls (HON-1207). Tested against
 * a database in `entry-context.db.test.ts`.
 */

export type EntryContextRefusal = 'not_found'

export class EntryContextError extends Error {
  constructor(readonly reason: EntryContextRefusal) {
    super(`Entry context refused: ${reason}`)
    this.name = 'EntryContextError'
  }
}

/**
 * An entry of a plan the household owns, with its meal, the meal's components
 * and their ingredients, and the translation rows for `locale` (none for
 * English). `meal` is null on an empty slot.
 *
 * Throws `not_found` when no such entry exists, including when it belongs to
 * another household's plan.
 */
export async function loadEntryForAi(
  householdId: string,
  planId: string,
  entryId: string,
  locale: string,
) {
  const ingredient = {
    select: {
      name: true,
      defaultUnit: true,
      measuredByVolume: true,
      ...ingredientTranslationsInclude(locale),
    },
  } as const
  const entry = await prisma.mealPlanEntry.findFirst({
    where: {
      id: entryId,
      planId,
      plan: { householdId },
    },
    include: {
      changes: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          originalIngredientId: true,
          replacementIngredientId: true,
          quantityPerServing: true,
          replacementIngredient: ingredient,
        },
      },
      meal: {
        include: {
          ...mealTranslationsInclude(locale),
          components: { include: { ingredient } },
        },
      },
    },
  })
  if (!entry) throw new EntryContextError('not_found')
  return {
    ...entry,
    // What the entry cooks, with its own changes merged (HON-1243): the prompt
    // names the yoghurt, not the cream it replaced. `meal.components` stays
    // the shared recipe.
    components: applyEntryChanges(entry.meal?.components ?? [], entry.changes),
  }
}

/**
 * The household's in-stock pantry items, by name, for the cook-question
 * prompt. Names only: the answer may say what the household has, never how
 * much. In stock means a staple, a quantity left, or none recorded; a 0 means
 * it ran out.
 */
export function loadPantryNamesForAi(householdId: string, locale: string) {
  return prisma.pantryItem.findMany({
    where: {
      householdId,
      OR: [{ isStaple: true }, { quantity: null }, { quantity: { gt: 0 } }],
    },
    select: {
      isStaple: true,
      ingredient: { select: { name: true, ...ingredientTranslationsInclude(locale) } },
    },
    orderBy: { ingredient: { name: 'asc' } },
  })
}

/** The inputs a tips prompt was priced from, as read before the AI call. */
export interface PricedFrom {
  entryId: string
  mealId: string | null
  servingOverride: number | null
  mealUpdatedAt: Date
  /** The stored `household.locale`, which a locale PATCH moves. */
  householdLocale: string
  /** The entry's ingredient changes the prompt merged, as `changeSetKey` reads them. */
  changes: readonly { id: string }[]
  /** The entry's "Adjust recipe" instruction the prompt followed (HON-1244). */
  adjustmentNote: string | null
}

/**
 * Cache `tips` on the entry, priced at `servings`, but only while the inputs
 * they were priced from still hold. Returns the number of rows written: 0 when
 * an input moved.
 *
 * Generation takes up to 45s, and a swap, a `servingOverride`, a locale PATCH
 * or an edit to the meal itself that commits in the meantime nulls this cache
 * precisely because one of those inputs moved (HON-681, HON-683). An
 * unconditional write would put the stale tips straight back, and every later
 * read is a cache hit, so the entry would keep pan sizes for a count nobody is
 * cooking, permanently rather than for one request.
 *
 * Same trick the entry PATCH uses for the same class of ordering problem
 * (`servingsWritableWhere` and its `updateManyAndReturn` claims): `updateMany`
 * matches nothing when an input moved, and writes nothing.
 *
 * The household's servings are a further priced-from input, but Prisma has no
 * filter for an aggregate over a relation, so the caller re-reads them and
 * skips this write when they moved (HON-684).
 */
export async function cachePreparationTips(
  pricedFrom: PricedFrom,
  tips: PreparationSteps,
  servings: number,
): Promise<number> {
  return prisma
    .$transaction(async (tx) => {
      const count = await writeGuardedTips(tx, pricedFrom, tips, servings)
      if (count === 0) return 0
      // The entry's ingredient changes are a priced-from input too (HON-1243),
      // and Prisma cannot filter on a relation's set. The write above holds the
      // entry's row lock, which every change write takes first
      // (`claimPlannedEntry`), so the set read here cannot move before this
      // commits, and one committed since the prompt was built is visible.
      const changesNow = await tx.mealPlanEntryComponent.findMany({
        where: { entryId: pricedFrom.entryId },
        select: { id: true },
      })
      if (changeSetKey(changesNow) !== changeSetKey(pricedFrom.changes)) {
        throw new ChangesMoved()
      }
      return count
    })
    .catch((error: unknown) => {
      if (error instanceof ChangesMoved) return 0
      throw error
    })
}

/** Rolls the tips write back: the change set moved while the prompt ran. */
class ChangesMoved extends Error {}

async function writeGuardedTips(
  tx: Prisma.TransactionClient,
  pricedFrom: PricedFrom,
  tips: PreparationSteps,
  servings: number,
): Promise<number> {
  const { count } = await tx.mealPlanEntry.updateMany({
    where: {
      id: pricedFrom.entryId,
      // A swap is the third writer that nulls this cache, and it resets
      // `servingOverride` to null — which is what the common entry already
      // stores, so the count alone would still match and the old meal's tips
      // would land on the new one.
      mealId: pricedFrom.mealId,
      servingOverride: pricedFrom.servingOverride,
      plan: { household: { locale: pricedFrom.householdLocale } },
      // `PATCH /api/households/me/meals/[id]` is the fourth writer that nulls
      // this cache, and it moves the meal's *contents* — name, time, notes,
      // components — while `mealId` stays put, so none of the fields above
      // would notice. `Meal.updatedAt` is `@updatedAt` and that route calls
      // `meal.update` unconditionally, so it moves on every such edit and is
      // the one field that does (HON-683). A meal edit the prompt does not read
      // (a `sourceUrl` fix) bumps it too and discards this write — the caller
      // still gets its tips, and the next open regenerates.
      meal: { is: { updatedAt: pricedFrom.mealUpdatedAt } },
      // The prompt follows the instruction (HON-1244). Every write that moves
      // it replaces the change set too, so the set check below would catch it;
      // pinned here as well so the guard does not lean on that.
      adjustmentNote: pricedFrom.adjustmentNote,
    },
    data: { preparationTips: serializePreparationSteps(tips, servings) },
  })
  return count
}
