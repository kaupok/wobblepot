import type { Prisma } from '@/generated/prisma/client'
import { getStartOfTodayInTimezone } from './dates'

/**
 * Drop the cached prep-tips JSON on a household's forward-looking entries.
 *
 * `MealPlanEntry.preparationTips` caches an AI response whose prompt is priced
 * at the entry's *effective* servings — `getEffectiveServings(entry, members)`,
 * which falls back to the household's member count when the entry carries no
 * `servingOverride`. That fallback is the default state of an entry, so a
 * member joining or leaving silently invalidates the tips on the household's
 * whole remaining plan: a household going from 2 to 4 keeps pan sizes and
 * timings for half the food it is actually cooking, and nothing regenerates
 * them — every later read is a cache hit in
 * `…/entries/[entryId]/preparation-tips/route.ts`.
 *
 * Call this inside the same transaction as the membership write, so a failed
 * write cannot leave the new member count beside the old household's tips.
 * Sites: the manual-member add, the member removal, and the account purge that
 * drops a membership from a household that survives it (HON-684). The rule it
 * serves is the AI-cache bullet in `docs/LOCALIZATION.md` → "AI surfaces
 * (Tier 1)"; the locale and per-entry-servings invalidations next to it are
 * HON-681's.
 *
 * Each clause of the `where` is load-bearing:
 *
 * - `servingOverride: null` — an entry with an override is priced from that
 *   override, so the member count never entered its prompt. Leave it alone.
 * - `date: { gte: <start of today> }` — tips for a meal already cooked are
 *   never read again, so regenerating them is pure AI spend. Entries are
 *   date-only, so this compares against midnight in the household's timezone
 *   rather than against the current time; `getStartOfTodayInTimezone` is the
 *   same derivation the shopping list and pantry routes use for plan dates.
 * - `preparationTips: { not: null }` — only touch rows that actually hold a
 *   cache, so an untouched plan costs no writes. This is also why the tips
 *   route has to guard its own cache write on the member count: a row that is
 *   mid-generation holds `null` here, so this clause excludes it and no
 *   invalidation from this side can stop the write that follows.
 *
 * The cost is real and accepted: a membership change now triggers a
 * regeneration burst across the remaining plan, each one a paid AI call
 * against the household's cap. Bounding it to future entries is what makes
 * that acceptable.
 */
export async function invalidateFutureEntryTips(
  tx: Prisma.TransactionClient,
  householdId: string,
  timezone: string,
): Promise<void> {
  await tx.mealPlanEntry.updateMany({
    where: {
      plan: { householdId },
      servingOverride: null,
      preparationTips: { not: null },
      date: { gte: getStartOfTodayInTimezone(timezone) },
    },
    data: { preparationTips: null },
  })
}
