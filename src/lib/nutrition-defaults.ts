import type { Member, MemberPreferences } from '@/types/member'

// Default nutritional values per standard portion (1x)
const BASE_CALORIES = 2000
const BASE_PROTEIN = 50

/**
 * Calculate default daily calorie target based on portion multiplier.
 * Default is 2000 kcal × portion size.
 */
export function getDefaultCalories(portionMultiplier: number): number {
  return Math.round(BASE_CALORIES * portionMultiplier)
}

/**
 * Calculate default daily protein target based on portion multiplier.
 * Default is 50g × portion size.
 */
export function getDefaultProtein(portionMultiplier: number): number {
  return Math.round(BASE_PROTEIN * portionMultiplier)
}

/**
 * Get the effective calorie value for a member, using defaults if not set.
 */
export function getEffectiveCalories(preferences: MemberPreferences | null): {
  value: number
  isDefault: boolean
} {
  const portionMultiplier = preferences?.portionMultiplier ?? 1.0

  if (preferences?.targetCalories != null) {
    return { value: preferences.targetCalories, isDefault: false }
  }

  return { value: getDefaultCalories(portionMultiplier), isDefault: true }
}

/**
 * Get the effective protein value for a member, using defaults if not set.
 */
export function getEffectiveProtein(preferences: MemberPreferences | null): {
  value: number
  isDefault: boolean
} {
  const portionMultiplier = preferences?.portionMultiplier ?? 1.0

  if (preferences?.targetProtein != null) {
    return { value: preferences.targetProtein, isDefault: false }
  }

  return { value: getDefaultProtein(portionMultiplier), isDefault: true }
}

/**
 * Calculate household aggregate nutrition totals.
 * Returns total calories, protein, member count, and how many use defaults.
 */
export function getHouseholdAggregate(members: Member[]): {
  totalCalories: number
  totalProtein: number
  memberCount: number
  defaultCount: number
} {
  let totalCalories = 0
  let totalProtein = 0
  let defaultCount = 0

  for (const member of members) {
    const calories = getEffectiveCalories(member.preferences)
    const protein = getEffectiveProtein(member.preferences)

    totalCalories += calories.value
    totalProtein += protein.value

    // Count member as using defaults if either value is default
    if (calories.isDefault || protein.isDefault) {
      defaultCount++
    }
  }

  return {
    totalCalories,
    totalProtein,
    memberCount: members.length,
    defaultCount,
  }
}
