export type { ExcludedMatch } from '@/lib/household/excluded-ingredient-match'

// Types matching Prisma enums
export type DietaryType = 'vegetarian' | 'vegan' | 'pescatarian'
export type Allergen =
  'gluten' | 'dairy' | 'eggs' | 'nuts' | 'peanuts' | 'soy' | 'fish' | 'shellfish' | 'sesame'
export type MealType = 'breakfast' | 'lunch' | 'dinner'

/** The household's preferences, as the Meal preferences tab's two forms read them. */
export interface HouseholdPreferencesValues {
  dietaryType: DietaryType | null
  allergensToAvoid: Allergen[]
  restrictions: string[]
  excludedIngredients: string[]
  weekdayMealTypes: MealType[]
  weekendMealTypes: MealType[]
}
