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
