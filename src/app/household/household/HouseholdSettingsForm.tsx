'use client'

import { HouseholdDetailsForm } from './HouseholdDetailsForm'
import { FoodPreferencesForm } from './FoodPreferencesForm'
import { MealsToPlanForm } from './MealsToPlanForm'
import type { HouseholdDetails, HouseholdPreferencesValues } from './settings-values'

interface HouseholdSettingsFormProps {
  household: HouseholdDetails
  preferences: HouseholdPreferencesValues | null
  isOwner: boolean
}

/**
 * The household settings: three sections, each an h2 at Section directly
 * under the page's h1, the Members list being the fourth (HON-960). Each
 * section is its own form with its own Save button, shown only while it has
 * unsaved changes (HON-961). The owner-only notice for a member is the
 * page's, under the h1.
 */
export function HouseholdSettingsForm({
  household,
  preferences,
  isOwner,
}: HouseholdSettingsFormProps) {
  return (
    <div className="flex flex-col gap-10">
      <HouseholdDetailsForm household={household} isOwner={isOwner} />
      <FoodPreferencesForm preferences={preferences} isOwner={isOwner} />
      <MealsToPlanForm preferences={preferences} isOwner={isOwner} />
    </div>
  )
}
