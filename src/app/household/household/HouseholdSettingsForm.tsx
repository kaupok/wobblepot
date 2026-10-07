'use client'

import { HouseholdDetailsForm } from './HouseholdDetailsForm'
import { FoodPreferencesForm } from './FoodPreferencesForm'
import { MealsToPlanForm } from './MealsToPlanForm'
import { WeeklyReminderForm } from './WeeklyReminderForm'
import type { HouseholdDetails, HouseholdPreferencesValues } from './settings-values'
import type { ReminderWeekday } from '@/lib/weekly-reminder-schedule'

interface HouseholdSettingsFormProps {
  household: HouseholdDetails
  preferences: HouseholdPreferencesValues | null
  isOwner: boolean
  /** The viewer's own weekly reminder weekday, null when it is off (HON-1084). */
  reminderWeekday: ReminderWeekday | null
}

/**
 * The household settings: four sections, each an h2 at Section directly
 * under the page's h1, with the Members list above them (HON-960). Each
 * section is its own form with its own Save button, shown only while it has
 * unsaved changes (HON-961). The owner-only notice for a member is the
 * page's, under the h1. The last section, Weekly reminder, is the viewer's
 * own setting, so a member can save it too (HON-1084).
 */
export function HouseholdSettingsForm({
  household,
  preferences,
  isOwner,
  reminderWeekday,
}: HouseholdSettingsFormProps) {
  return (
    <div className="flex flex-col gap-10">
      <HouseholdDetailsForm household={household} isOwner={isOwner} />
      <FoodPreferencesForm preferences={preferences} isOwner={isOwner} />
      <MealsToPlanForm preferences={preferences} isOwner={isOwner} />
      <WeeklyReminderForm weekday={reminderWeekday} isOwner={isOwner} />
    </div>
  )
}
