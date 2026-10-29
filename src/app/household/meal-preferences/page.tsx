import { Body } from '@/components/ui/typography'
import { matchExcludedIngredients } from '@/lib/household/preferences'

import { householdTabMetadata, requireHouseholdMember } from '../household-member'
import { FoodPreferencesForm } from './FoodPreferencesForm'
import { MealsToPlanForm } from './MealsToPlanForm'

export function generateMetadata() {
  return householdTabMetadata('mealPreferences')
}

/**
 * Household → Meal preferences (HON-1257): what the plan may contain and which
 * meals it fills. Each section is its own form with its own Save button
 * (HON-961), an h2 at Section under the layout's h1 (HON-960).
 */
export default async function HouseholdMealPreferencesPage() {
  const { membership, t, isOwner } = await requireHouseholdMember()
  const stored = membership.household.preferences
  const preferences = stored
    ? {
        dietaryType: stored.dietaryType,
        allergensToAvoid: stored.allergensToAvoid,
        restrictions: stored.restrictions,
        excludedIngredients: stored.excludedIngredients,
        weekdayMealTypes: stored.weekdayMealTypes,
        weekendMealTypes: stored.weekendMealTypes,
      }
    : null
  // What each saved tag excludes, so the form can warn about one that matches nothing (HON-1321).
  const excludedMatches = await matchExcludedIngredients(
    membership.household.id,
    stored?.excludedIngredients ?? [],
  )

  return (
    <div className="flex flex-col gap-10">
      {/* Both routes are owner-only (HON-677), so a member reads why the
          forms are locked (HON-960). */}
      {!isOwner && <Body variant="muted">{t('settings.ownerOnlyNotice')}</Body>}
      <FoodPreferencesForm
        preferences={preferences}
        excludedMatches={excludedMatches}
        isOwner={isOwner}
      />
      <MealsToPlanForm preferences={preferences} isOwner={isOwner} />
    </div>
  )
}
