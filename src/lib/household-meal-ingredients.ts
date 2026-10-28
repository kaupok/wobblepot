import 'server-only'
import { prisma } from '@/lib/prisma'
import { HouseholdMealError } from '@/lib/household-meal-error'

/** One validated component, as `mealComponentsSchema` outputs it. */
export interface HouseholdMealComponentInput {
  ingredientId: string
  /** The recipe's total, in the ingredient's default unit; 0 for a vague row. */
  totalQuantity: number
  isVague?: boolean
  originalPhrase?: string | null
}

/**
 * The components' ingredients, if every one is global or the household's own.
 * Another household's ingredient reads as not found, so its id is not
 * revealed (HON-889). Repeated ids were already rejected by
 * `mealComponentsSchema`.
 */
export async function findComponentIngredients(
  householdId: string,
  components: HouseholdMealComponentInput[],
) {
  const ingredientIds = components.map((c) => c.ingredientId)
  const ingredients = await prisma.ingredient.findMany({
    where: {
      id: { in: ingredientIds },
      OR: [{ householdId: null }, { householdId }],
    },
    select: {
      id: true,
      proteinType: true,
      protein: true,
      // For the image ranking in `updateHouseholdMeal`, which orders by grams
      // as the prompt does.
      defaultUnit: true,
      gramsPerPiece: true,
      densityGPerMl: true,
    },
  })

  if (ingredients.length !== ingredientIds.length) {
    const foundIds = new Set(ingredients.map((i) => i.id))
    throw new HouseholdMealError(
      'ingredientsNotFound',
      ingredientIds.filter((id) => !foundIds.has(id)),
    )
  }

  return new Map(ingredients.map((i) => [i.id, i]))
}
