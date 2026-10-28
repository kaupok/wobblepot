import { ProteinType } from '@/generated/prisma/enums'
import { componentGramsPerServing } from './nutrition'

/**
 * Component data needed for protein type derivation.
 */
export interface ComponentForProtein {
  quantityPerServing: number
  /** Vague components carry a gram default, not a real quantity, and are skipped. */
  isVague?: boolean
  ingredient: {
    proteinType?: ProteinType | null
    protein: number
    /** `quantityPerServing` is in this unit — pieces are converted to grams (HON-713). */
    defaultUnit: string
    gramsPerPiece?: number | null
  }
}

/**
 * Derive the primary protein type for a meal based on its ingredients.
 *
 * Logic:
 * 1. Find all non-vague components whose ingredients have a proteinType set
 * 2. Calculate total protein contribution (grams) for each: grams * protein/100,
 *    converting piece-unit quantities to grams first
 * 3. Return the proteinType of the ingredient with highest protein contribution
 * 4. If no ingredients have proteinType, return 'none'
 */
export function deriveProteinType(components: ComponentForProtein[]): ProteinType {
  let maxProteinGrams = 0
  let primaryType: ProteinType = 'none'

  for (const comp of components) {
    const { proteinType } = comp.ingredient
    if (!proteinType || comp.isVague) continue

    // Protein values are per 100g, so piece quantities are converted to grams first
    const grams = componentGramsPerServing(comp.quantityPerServing, comp.ingredient)
    const proteinGrams = (grams * comp.ingredient.protein) / 100

    if (proteinGrams > maxProteinGrams) {
      maxProteinGrams = proteinGrams
      primaryType = proteinType
    }
  }

  return primaryType
}

/**
 * Whether a household's chosen main protein (HON-1386) still fits the
 * recipe: it is not `none`, and a non-vague component's ingredient carries
 * it. Vague components are skipped, as in `deriveProteinType`, so a pinch of
 * an ingredient cannot hold the label up.
 */
export function isProteinOverrideValid(
  components: ComponentForProtein[],
  override: ProteinType,
): boolean {
  return (
    override !== 'none' &&
    components.some((comp) => !comp.isVague && comp.ingredient.proteinType === override)
  )
}

/**
 * The protein fields a write stores. A valid override wins; an invalid one is
 * dropped, so the override never outlives its ingredient, and the derived
 * value takes over. Every household-recipe write path calls this.
 */
export function resolveProteinType(
  components: ComponentForProtein[],
  override: ProteinType | null,
): { primaryProteinType: ProteinType; proteinTypeOverride: ProteinType | null } {
  if (override && isProteinOverrideValid(components, override)) {
    return { primaryProteinType: override, proteinTypeOverride: override }
  }
  return { primaryProteinType: deriveProteinType(components), proteinTypeOverride: null }
}

/**
 * The distinct protein types of a recipe's non-vague components, in the order
 * they first appear. The recipe form offers the main-protein choice when
 * there are two or more.
 */
export function distinctProteinTypes(components: ComponentForProtein[]): ProteinType[] {
  const types = new Set<ProteinType>()
  for (const comp of components) {
    const { proteinType } = comp.ingredient
    if (proteinType && proteinType !== 'none' && !comp.isVague) types.add(proteinType)
  }
  return [...types]
}
