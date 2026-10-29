import { z } from 'zod'
import { IngredientCategory, MealType, ProteinType, Unit } from '@/generated/prisma/enums'
import type {
  IngredientAlternative,
  PrefilledIngredient,
} from '@/components/household/meal-form-types'

const alternativeSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(IngredientCategory),
  defaultUnit: z.enum(Unit),
  measuredByVolume: z.boolean().optional(),
  gramsPerPiece: z.number().nullable().optional(),
  protein: z.number().optional(),
  proteinType: z.enum(ProteinType).nullable().optional(),
  similarity: z.number(),
}) satisfies z.ZodType<IngredientAlternative>

const prefilledIngredientSchema = z.object({
  type: z.enum(['matched', 'low-confidence', 'unmatched']),
  ingredient: z
    .object({
      id: z.string(),
      name: z.string(),
      category: z.enum(IngredientCategory),
      defaultUnit: z.enum(Unit),
      gramsPerPiece: z.number().nullable().optional(),
      measuredByVolume: z.boolean().optional(),
      calories: z.number().optional(),
      protein: z.number().optional(),
      carbs: z.number().optional(),
      fat: z.number().optional(),
      proteinType: z.enum(ProteinType).nullable().optional(),
    })
    .optional(),
  convertedQuantity: z.number().optional(),
  isVague: z.boolean().optional(),
  originalPhrase: z.string().nullable().optional(),
  lowConfidence: z.boolean().optional(),
  alternatives: z.array(alternativeSchema).optional(),
  extractedName: z.string().optional(),
  originalText: z.string().optional(),
  extractedQuantity: z.number().optional(),
  extractedUnit: z.string().optional(),
}) satisfies z.ZodType<PrefilledIngredient>

const prefilledMealSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  preparationNotes: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  timeMinutes: z.number().nullable(),
  servings: z.number(),
  mealTypes: z.array(z.enum(MealType)),
  kidFriendly: z.boolean(),
  prefilledIngredients: z.array(prefilledIngredientSchema),
  originalRecipeText: z.string().optional(),
  /**
   * Where Cancel should return to. Set by the imagine flow's "Edit details"
   * (`ImagineClient.handleEditDetails`); the import flow omits it and keeps the
   * `/recipes` fallback.
   */
  returnTo: z.string().nullable().optional(),
  /**
   * Which flow wrote the stash, so a save fires that flow's event (HON-1063).
   * Absent means the blank form. `originalRecipeText` is a form field, not an
   * analytics marker.
   */
  origin: z.enum(['import', 'imagine']).optional(),
})

export type PrefilledMeal = z.infer<typeof prefilledMealSchema>

/**
 * Reads the `prefilled-meal` stash that the import and imagine flows write.
 * Storage is stale or hand-edited at times, so anything that is not valid JSON
 * of this shape returns `null` and the form opens empty.
 */
export function parsePrefilledMeal(stored: string): PrefilledMeal | null {
  let raw: unknown
  try {
    raw = JSON.parse(stored)
  } catch {
    return null
  }
  const parsed = prefilledMealSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
