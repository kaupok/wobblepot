import 'server-only'

import { fillEmptySlots, type FillEmptySlotsResult } from '@/lib/ai/fill-plan'
import { recordAiUsage } from '@/lib/ai/usage'
import type { getHouseholdMembership } from '@/lib/household'
import { getExcludedIngredientIds } from '@/lib/household/excluded-ingredients'

/** The most days one Generate, Fill days or `fill_plan` call plans. */
export const MAX_PLAN_DAYS = 14

type PlanningHousehold = NonNullable<
  Awaited<ReturnType<typeof getHouseholdMembership>>
>['household']

/**
 * Fills the empty slots of `[startDate, endDate)` in the household's plan from
 * its preferences, the way the planner's Fill days does. The generate route
 * and the `fill_plan` MCP tool both call it, so the generator gets the same
 * inputs from either (HON-1649). Throws what `fillEmptySlots` throws.
 */
export async function fillHouseholdEmptySlots(
  household: PlanningHousehold,
  options: { planId: string; startDate: Date; endDate: Date; locale: string; aiBudgetMs: number },
): Promise<FillEmptySlotsResult> {
  const preferences = household.preferences
  // The tags are resolved now, so a rule change since they were saved applies (HON-1321).
  const excludedIngredientIds = await getExcludedIngredientIds(
    household.id,
    preferences?.excludedIngredients ?? [],
  )
  return fillEmptySlots({
    ...options,
    householdId: household.id,
    dietaryType: preferences?.dietaryType ?? null,
    allergensToAvoid: preferences?.allergensToAvoid ?? [],
    excludedIngredientIds,
    restrictions: preferences?.restrictions ?? [],
    weekdayMealTypes: preferences?.weekdayMealTypes ?? ['dinner'],
    weekendMealTypes: preferences?.weekendMealTypes ?? ['dinner'],
    timezone: household.timezone,
    onAiUsage: (usage) =>
      recordAiUsage({ householdId: household.id, feature: 'plan_fill_empty', ...usage }),
  })
}
