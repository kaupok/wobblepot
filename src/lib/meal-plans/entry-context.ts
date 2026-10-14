import 'server-only'
import { prisma } from '@/lib/prisma'
import { ingredientTranslationsInclude, mealTranslationsInclude } from '@/lib/i18n/content'
import { serializePreparationSteps } from '@/lib/preparation-steps'
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
  const entry = await prisma.mealPlanEntry.findFirst({
    where: {
      id: entryId,
      planId,
      plan: { householdId },
    },
    include: {
      meal: {
        include: {
          ...mealTranslationsInclude(locale),
          components: {
            include: {
              ingredient: {
                select: {
                  name: true,
                  defaultUnit: true,
                  measuredByVolume: true,
                  ...ingredientTranslationsInclude(locale),
                },
              },
            },
          },
        },
      },
    },
  })
  if (!entry) throw new EntryContextError('not_found')
  return entry
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
  const { count } = await prisma.mealPlanEntry.updateMany({
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
    },
    data: { preparationTips: serializePreparationSteps(tips, servings) },
  })
  return count
}
