import { z } from 'zod'

import { Allergen, IngredientCategory, ProteinType, Unit } from '@/generated/prisma/enums'

import {
  GRAMS_PER_PIECE_MAX,
  isProteinTypedCategory,
  NEW_INGREDIENT_NAME_MAX,
  NUTRITION_MAX,
  PROTEIN_TYPES_BY_CATEGORY,
} from './new-ingredient'

/**
 * The body of `POST /api/ingredients` (HON-1263) and `PATCH
 * /api/ingredients/[id]` (HON-1264): a household ingredient's name, category
 * and per-100 g label values. Error messages are English, for logs; the form
 * reads only the field names in `details`.
 */

/** Per 100 g, from 0 to the bound in `NUTRITION_MAX`. */
const per100g = (max: number) => z.number().finite().min(0).max(max)

export const ingredientInputSchema = z
  .object({
    name: z.string().trim().min(1).max(NEW_INGREDIENT_NAME_MAX),
    category: z.enum(IngredientCategory),
    proteinType: z.enum(ProteinType).optional(),
    defaultUnit: z.enum(Unit),
    gramsPerPiece: z.number().finite().gt(0).max(GRAMS_PER_PIECE_MAX).optional(),
    allergens: z
      .array(z.enum(Allergen))
      .refine((list) => new Set(list).size === list.length, 'Repeated allergen'),
    calories: per100g(NUTRITION_MAX.calories),
    protein: per100g(NUTRITION_MAX.protein),
    carbs: per100g(NUTRITION_MAX.carbs),
    fat: per100g(NUTRITION_MAX.fat),
    fiber: per100g(NUTRITION_MAX.fiber).optional(),
  })
  .superRefine((body, ctx) => {
    if (isProteinTypedCategory(body.category)) {
      const allowed: readonly string[] = PROTEIN_TYPES_BY_CATEGORY[body.category]
      if (!body.proteinType || !allowed.includes(body.proteinType)) {
        ctx.addIssue({
          code: 'custom',
          path: ['proteinType'],
          message: `One of ${allowed.join(', ')} for ${body.category}`,
        })
      }
    } else if (body.proteinType !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['proteinType'], message: 'Not for this category' })
    }
    if (body.defaultUnit === 'piece' && body.gramsPerPiece === undefined) {
      ctx.addIssue({ code: 'custom', path: ['gramsPerPiece'], message: 'Required for piece' })
    }
    if (body.defaultUnit === 'g' && body.gramsPerPiece !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['gramsPerPiece'], message: 'Only for piece' })
    }
  })
