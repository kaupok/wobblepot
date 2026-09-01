export type DietaryType = 'vegetarian' | 'vegan' | 'pescatarian'

export type Allergen =
  'gluten' | 'dairy' | 'eggs' | 'nuts' | 'peanuts' | 'soy' | 'fish' | 'shellfish' | 'sesame'

export interface MemberPreferences {
  displayName: string | null
  portionMultiplier: number
  targetCalories: number | null
  targetProtein: number | null
  targetCarbs: number | null
  targetFat: number | null
  dietaryType: DietaryType | null
  allergens: Allergen[]
  restrictions: string[]
  excludedIngredients: string[]
  excludedIngredientIds: string[]
}

export interface MemberUser {
  id: string
  name: string | null
  email: string
  image: string | null
}

export interface MemberInvite {
  url: string
  expiresAt: string
  isActive: boolean
}

export interface Member {
  id: string
  userId: string | null
  name: string | null
  role: 'owner' | 'member'
  joinedAt: string
  user: MemberUser | null
  preferences: MemberPreferences | null
  invite: MemberInvite | null
}
