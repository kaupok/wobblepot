import type { Locale } from '@/lib/i18n/locales'

// Types matching Prisma enums
export type DietaryType = 'vegetarian' | 'vegan' | 'pescatarian'
export type Allergen =
  'gluten' | 'dairy' | 'eggs' | 'nuts' | 'peanuts' | 'soy' | 'fish' | 'shellfish' | 'sesame'
export type MealType = 'breakfast' | 'lunch' | 'dinner'

export interface HouseholdDetails {
  id: string
  name: string
  timezone: string
  locale: Locale
}

export interface HouseholdPreferencesValues {
  dietaryType: DietaryType | null
  allergensToAvoid: Allergen[]
  restrictions: string[]
  excludedIngredients: string[]
  weekdayMealTypes: MealType[]
  weekendMealTypes: MealType[]
}

export type SettingsValue = string | number | null | readonly string[]

function sameArray(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false
  const sortedB = [...b].sort()
  return [...a].sort().every((item, i) => item === sortedB[i])
}

/**
 * Whether two snapshots of a settings section hold the same values. Shallow:
 * every field is a scalar or a list, and a list compares by content with its
 * order ignored, so ticking and unticking an allergen leaves the section clean
 * even though the item moved to the end (HON-961).
 */
export function sameValues<T extends Record<keyof T, SettingsValue>>(a: T, b: T) {
  return (Object.keys(a) as (keyof T)[]).every((key) => {
    const left = a[key]
    const right = b[key]
    if (Array.isArray(left) && Array.isArray(right)) return sameArray(left, right)
    return left === right
  })
}
