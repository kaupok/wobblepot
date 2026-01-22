import { prisma } from '@/lib/prisma'
import {
  Allergen,
  DietaryType,
  IngredientCategory,
  MealType,
  ProteinType,
} from '@/generated/prisma/enums'

export const MAX_TIME_MINUTES = 60

/**
 * Map dietary type to protein types that should be excluded.
 * These are hard filters - meals with these protein types will never appear.
 */
export function getExcludedProteinTypes(dietaryType: DietaryType): ProteinType[] {
  switch (dietaryType) {
    case 'omnivore':
      return []
    case 'vegetarian':
      // Exclude all meat, poultry, and fish
      return ['poultry', 'beef', 'pork', 'lamb', 'fish']
    case 'vegan':
      // Exclude all animal products
      return ['poultry', 'beef', 'pork', 'lamb', 'fish', 'eggs', 'dairy']
    case 'pescatarian':
      // Exclude meat/poultry but allow fish
      return ['poultry', 'beef', 'pork', 'lamb']
    default: {
      const _exhaustive: never = dietaryType
      throw new Error(`Unhandled dietary type: ${_exhaustive}`)
    }
  }
}

/**
 * Number of days to look back when excluding recently used meals.
 * Exported for callers to use when computing recentMealIds.
 */
export const NO_REPEAT_DAYS = 14

export interface CandidateFilters {
  mealType: MealType
  allergensToAvoid: Allergen[]
  excludedIngredientIds: string[]
  recentMealIds: string[]
  dietaryType?: DietaryType
  primaryProteinType?: ProteinType
  maxTimeMinutes?: number
  householdId?: string
  favoriteMealIds?: string[]
}

export interface CandidateMeal {
  id: string
  name: string
  kidFriendly: boolean
  primaryProteinType: ProteinType
  topIngredients: { name: string; category: IngredientCategory }[]
  isFavorite: boolean
  isCustom: boolean
}

/**
 * Pre-filter meals by hard constraints before AI selection.
 * Database handles: allergens, excluded ingredients, time, recent history, protein type.
 * AI handles: variety and final selection from filtered candidates.
 *
 * When householdId is provided, includes both system meals (householdId: null)
 * and custom meals belonging to that household.
 */
export async function getCandidates(filters: CandidateFilters): Promise<CandidateMeal[]> {
  const maxTime = filters.maxTimeMinutes ?? MAX_TIME_MINUTES
  const favoriteMealIds = new Set(filters.favoriteMealIds ?? [])
  const excludedProteinTypes = filters.dietaryType
    ? getExcludedProteinTypes(filters.dietaryType)
    : []

  const meals = await prisma.meal.findMany({
    where: {
      suitableFor: { has: filters.mealType },
      // Only non-deleted meals
      deletedAt: null,
      // Include system meals + household's custom meals if householdId provided
      ...(filters.householdId
        ? { OR: [{ householdId: null }, { householdId: filters.householdId }] }
        : { householdId: null }),
      AND: [
        // Hard filter: dietary type - exclude meals with protein types not allowed
        ...(excludedProteinTypes.length > 0
          ? [{ primaryProteinType: { notIn: excludedProteinTypes } }]
          : []),
        // Hard filter: allergens - exclude meals with any allergen-containing ingredients
        ...(filters.allergensToAvoid.length > 0
          ? [
              {
                NOT: {
                  components: {
                    some: {
                      ingredient: {
                        allergens: { hasSome: filters.allergensToAvoid },
                      },
                    },
                  },
                },
              },
            ]
          : []),
        // Hard filter: excluded ingredients
        ...(filters.excludedIngredientIds.length > 0
          ? [
              {
                NOT: {
                  components: {
                    some: { ingredientId: { in: filters.excludedIngredientIds } },
                  },
                },
              },
            ]
          : []),
        // Recent history: exclude recently used meals
        ...(filters.recentMealIds.length > 0 ? [{ id: { notIn: filters.recentMealIds } }] : []),
        // Protein type filter (for slot-specific queries)
        ...(filters.primaryProteinType ? [{ primaryProteinType: filters.primaryProteinType }] : []),
      ],
      // Time constraint: <= maxTime OR null (no time data)
      OR: [{ timeMinutes: { lte: maxTime } }, { timeMinutes: null }],
    },
    select: {
      id: true,
      name: true,
      kidFriendly: true,
      primaryProteinType: true,
      householdId: true,
      components: {
        orderBy: { quantityPerServing: 'desc' },
        take: 3,
        select: {
          ingredient: {
            select: { name: true, category: true },
          },
        },
      },
    },
  })

  // Transform to CandidateMeal format
  return meals.map((meal) => ({
    id: meal.id,
    name: meal.name,
    kidFriendly: meal.kidFriendly,
    primaryProteinType: meal.primaryProteinType,
    topIngredients: meal.components.map((c) => ({
      name: c.ingredient.name,
      category: c.ingredient.category,
    })),
    isFavorite: favoriteMealIds.has(meal.id),
    isCustom: meal.householdId !== null,
  }))
}
