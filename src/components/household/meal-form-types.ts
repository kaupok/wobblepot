import type { IngredientCategory, MealType, Unit } from '@/generated/prisma/enums'
import type { IngredientRowData } from '@/components/recipes/IngredientRow'
import type { IngredientResult } from '@/hooks/use-ingredient-search'

export type MealTypeValue = 'breakfast' | 'lunch' | 'dinner'

export const MEAL_TYPE_VALUES: readonly MealTypeValue[] = ['breakfast', 'lunch', 'dinner'] as const

// Defined by the search hook that produces it; re-exported here so meal-form
// callers keep a single import for the form's types.
export type { IngredientResult }

export interface IngredientAlternative {
  id: string
  name: string
  category: IngredientCategory
  defaultUnit: Unit
  similarity: number
}

// Internal component for resolved ingredients (matched, high-confidence)
export interface MealComponent {
  ingredientId: string
  ingredient: IngredientResult
  totalQuantity: number
  isVague?: boolean
  originalPhrase?: string | null
}

// Enhanced prefilled data that includes match states
export interface PrefilledIngredient {
  type: 'matched' | 'low-confidence' | 'unmatched'
  // For matched and low-confidence
  ingredient?: {
    id: string
    name: string
    category: IngredientCategory
    defaultUnit: Unit
    gramsPerPiece?: number | null
    calories?: number
    protein?: number
    carbs?: number
    fat?: number
  }
  convertedQuantity?: number
  isVague?: boolean
  originalPhrase?: string | null
  // For low-confidence
  lowConfidence?: boolean
  alternatives?: IngredientAlternative[]
  extractedName?: string
  // For unmatched
  originalText?: string
  extractedQuantity?: number
  extractedUnit?: string
}

export interface MealFormData {
  id?: string
  name: string
  description?: string | null
  preparationNotes?: string | null
  sourceUrl?: string | null
  timeMinutes?: number | null
  kidFriendly: boolean
  suitableFor: MealType[]
  servings?: number
  // Standard components (for editing existing meals)
  components?: {
    ingredientId: string
    quantityPerServing: number
    isVague?: boolean
    originalPhrase?: string | null
    ingredient: {
      id: string
      name: string
      category: IngredientCategory
      defaultUnit: Unit
      gramsPerPiece?: number | null
      calories?: number
      protein?: number
      carbs?: number
      fat?: number
    }
  }[]
  // Enhanced prefilled ingredients (for recipe import with match states)
  prefilledIngredients?: PrefilledIngredient[]
  // Original recipe text (for import mode - allows user to reference while editing)
  originalRecipeText?: string
}

export interface MealFormProps {
  meal?: MealFormData
  defaultServings?: number
  onSuccess: () => void
  onCancel: () => void
}

// Display 'g' for gram quantities; hide the unit for piece-counted items (the
// number alone reads more naturally — "5 lemons" not "5 pcs lemons"). Estonian
// translations live in the catalog under `enums.Unit.*` for any future
// consumer that wants to render piece units explicitly.
export function formatUnit(unit: Unit): string {
  return unit === 'g' ? 'g' : ''
}

function formatIngredientList(names: string[], maxDisplay: number = 3): string {
  if (names.length <= maxDisplay) {
    return names.join(', ')
  }
  const displayed = names.slice(0, maxDisplay)
  const remaining = names.length - maxDisplay
  return `${displayed.join(', ')} +${remaining} more`
}

export interface FinalComponent {
  ingredientId: string
  totalQuantity: number
  isVague: boolean
  originalPhrase: string | null
}

/**
 * Validate and build the final components array for submission.
 * Returns { components } on success, or { error } on validation failure.
 */
export function buildFinalComponents(
  isImportMode: boolean,
  ingredientRows: IngredientRowData[],
  components: MealComponent[],
): { components: FinalComponent[]; error?: never } | { error: string; components?: never } {
  let finalComponents: FinalComponent[]

  if (isImportMode) {
    const unresolved = ingredientRows.filter(
      (r): r is Extract<IngredientRowData, { type: 'unmatched' }> => r.type === 'unmatched',
    )
    if (unresolved.length > 0) {
      const names = unresolved.map((r) => r.extractedName)
      return { error: `Resolve unmatched ingredients: ${formatIngredientList(names)}` }
    }

    const lowConfidence = ingredientRows.filter(
      (r): r is Extract<IngredientRowData, { type: 'low-confidence' }> =>
        r.type === 'low-confidence',
    )
    if (lowConfidence.length > 0) {
      const names = lowConfidence.map((r) => r.extractedName)
      return { error: `Verify matches before saving: ${formatIngredientList(names)}` }
    }

    finalComponents = ingredientRows
      .filter((r): r is Extract<IngredientRowData, { type: 'matched' }> => r.type === 'matched')
      .map((r) => ({
        ingredientId: r.ingredient.id,
        totalQuantity: r.isVague ? 0 : r.totalQuantity,
        isVague: r.isVague ?? false,
        originalPhrase: r.originalPhrase ?? null,
      }))
  } else {
    finalComponents = components.map((c) => ({
      ingredientId: c.ingredientId,
      totalQuantity: c.isVague ? 0 : c.totalQuantity,
      isVague: c.isVague ?? false,
      originalPhrase: c.originalPhrase ?? null,
    }))
  }

  if (finalComponents.length === 0) {
    return { error: 'Add at least one ingredient' }
  }

  if (isImportMode) {
    const invalidRows = ingredientRows.filter(
      (r): r is Extract<IngredientRowData, { type: 'matched' }> =>
        r.type === 'matched' && !r.isVague && r.totalQuantity <= 0,
    )
    if (invalidRows.length > 0) {
      const names = invalidRows.map((r) => r.ingredient.name)
      return { error: `Quantity must be greater than 0: ${formatIngredientList(names)}` }
    }
  } else {
    const invalidComps = components.filter((c) => !c.isVague && c.totalQuantity <= 0)
    if (invalidComps.length > 0) {
      const names = invalidComps.map((c) => c.ingredient.name)
      return { error: `Quantity must be greater than 0: ${formatIngredientList(names)}` }
    }
  }

  return { components: finalComponents }
}
