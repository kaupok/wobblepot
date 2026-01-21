import { ProteinType } from '@/generated/prisma/enums'

/**
 * Component data needed for protein type derivation.
 */
export interface ComponentForProtein {
  quantityPerServing: number
  ingredient: {
    proteinType?: ProteinType | null
    protein: number
  }
}

/**
 * Derive the primary protein type for a meal based on its ingredients.
 *
 * Logic:
 * 1. Find all components whose ingredients have a proteinType set
 * 2. Calculate total protein contribution (grams) for each: quantity * protein/100
 * 3. Return the proteinType of the ingredient with highest protein contribution
 * 4. If no ingredients have proteinType, return 'none'
 */
export function deriveProteinType(components: ComponentForProtein[]): ProteinType {
  let maxProteinGrams = 0
  let primaryType: ProteinType = 'none'

  for (const comp of components) {
    const { proteinType } = comp.ingredient
    if (!proteinType) continue

    // Calculate protein grams from this component
    // proteinType ingredients typically have protein values per 100g
    const proteinGrams = (comp.quantityPerServing * comp.ingredient.protein) / 100

    if (proteinGrams > maxProteinGrams) {
      maxProteinGrams = proteinGrams
      primaryType = proteinType
    }
  }

  return primaryType
}
