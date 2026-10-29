import 'server-only'

import type { Prisma } from '@/generated/prisma/client'
import type { Allergen, DietaryType, MealType } from '@/generated/prisma/enums'
import { loadHouseholdServings } from '@/lib/household'
import { getExcludedIngredientIds } from '@/lib/household/excluded-ingredients'
import { invalidateFutureEntrySteps } from '@/lib/meal-planning/preparation-steps-cache'
import { sumPortions } from '@/lib/meal-planning/servings'
import { prisma } from '@/lib/prisma'

/**
 * Persistence for household preferences, behind
 * `/api/households/me/preferences` (HON-1213), and for a member's display name
 * and portion size, behind the member routes. Food rules are household-level
 * only (HON-1322). The routes own the session, the household, the owner check and
 * body validation; these functions own every query, and are tested against a
 * database in `preferences.db.test.ts`.
 */

/**
 * Counts the planned meals that break a household's preferences (HON-1126).
 * Exported from here so the preferences route reaches every query through one
 * module.
 */
export { countConflictingPlannedEntries } from '@/lib/meal-planning/count-preference-conflicts'

/** The rows each "Ingredients to avoid" tag excludes, for the form (HON-1321). */
export { matchExcludedIngredients } from '@/lib/household/excluded-ingredients'

/** The validated body of a household preferences update. An absent key is left alone. */
export interface HouseholdPreferencesPatch {
  dietaryType?: DietaryType | null
  allergensToAvoid?: Allergen[]
  restrictions?: string[]
  excludedIngredients?: string[]
  excludedIngredientIds?: string[]
  weekdayMealTypes?: MealType[]
  weekendMealTypes?: MealType[]
}

/** The validated body of a member preferences update. An absent key is left alone. */
export interface MemberPreferencesPatch {
  displayName?: string | null
  portionMultiplier?: number
}

/**
 * Save a household's preferences and return the stored row. Sending
 * `excludedIngredients` replaces `excludedIngredientIds` with the ids those
 * names resolve to now. The filters do not read the stored ids: they resolve
 * the names again (`getExcludedIngredientIds`), so the ids are a record for
 * the data export.
 *
 * Upsert, not update: a household whose preferences row is missing self-heals
 * on first save instead of failing on Prisma's P2025 (HON-672).
 */
export async function updateHouseholdPreferences(
  householdId: string,
  patch: HouseholdPreferencesPatch,
) {
  const data = patch.excludedIngredients
    ? {
        ...patch,
        excludedIngredientIds: await getExcludedIngredientIds(
          householdId,
          patch.excludedIngredients,
        ),
      }
    : patch

  return prisma.householdPreferences.upsert({
    where: { householdId },
    update: data,
    create: { householdId, ...data },
  })
}

/**
 * The member whose preferences are saved, with their household as
 * `getHouseholdMembership` returns it.
 */
export interface PreferencesMember {
  id: string
  householdId: string
  household: {
    timezone: string
    /** Every member's portion size before this save, for `sumPortions`. */
    members: readonly { preferences: { portionMultiplier: number } | null }[]
  }
}

/**
 * Save a member's preferences, on a transaction the caller holds, so
 * `updateMember` can save a name and preferences together. Returns the stored
 * row.
 *
 * A portion size is summed into the household's servings, which price the
 * cached prep tips on every entry without a `servingOverride` (HON-1040).
 * Clear them only when those servings moved: the sum is rounded to 0.5, so
 * 1.5 + 0.75 and 1.5 + 1 both price 2.5, and a needless invalidation costs a
 * paid regeneration per entry (HON-684). `portionChanged` is the cheap guard
 * that skips the re-read.
 */
export async function writeMemberPreferences(
  tx: Prisma.TransactionClient,
  member: PreferencesMember,
  patch: MemberPreferencesPatch,
) {
  const { portionMultiplier } = patch
  const stored =
    portionMultiplier === undefined
      ? null
      : await tx.memberPreferences.findUnique({
          where: { memberId: member.id },
          select: { portionMultiplier: true },
        })
  // A missing preferences row is the column default, 1×.
  const portionChanged =
    portionMultiplier !== undefined && portionMultiplier !== (stored?.portionMultiplier ?? 1)

  const saved = await tx.memberPreferences.upsert({
    where: { memberId: member.id },
    create: { memberId: member.id, ...patch },
    update: patch,
  })

  if (
    portionChanged &&
    (await loadHouseholdServings(member.householdId, tx)) !== sumPortions(member.household.members)
  ) {
    await invalidateFutureEntrySteps(tx, member.householdId, member.household.timezone)
  }

  return saved
}
