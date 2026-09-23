import { z } from 'zod'

/** Upper bound on a meal's component list, shared by the create and update routes. */
export const MAX_MEAL_COMPONENTS = 50

const mealComponentSchema = z
  .object({
    ingredientId: z.string().min(1),
    totalQuantity: z.number().nonnegative(),
    isVague: z.boolean().optional().default(false),
    originalPhrase: z.string().nullish(),
  })
  .refine((c) => c.isVague || c.totalQuantity > 0, {
    message: 'Quantity must be greater than 0 for non-vague components',
  })
  .transform((c) => ({
    ...c,
    totalQuantity: c.isVague ? 0 : c.totalQuantity,
  }))

/**
 * A meal's component list. A repeated `ingredientId` is rejected here rather
 * than at write time: `createMany` would hit `@@unique([mealId, ingredientId])`
 * and answer 500, and the ingredient existence check cannot tell a repeated id
 * from a missing one. The repeated ids ride on the issue's `params` so the
 * routes can name them — read them back with `duplicateComponentIds`.
 */
export const mealComponentsSchema = z
  .array(mealComponentSchema)
  .min(1)
  .max(MAX_MEAL_COMPONENTS)
  .superRefine((components, ctx) => {
    const seen = new Set<string>()
    const duplicates = new Set<string>()

    for (const { ingredientId } of components) {
      if (seen.has(ingredientId)) duplicates.add(ingredientId)
      else seen.add(ingredientId)
    }

    if (duplicates.size > 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Duplicate ingredients in components',
        params: { duplicateIds: [...duplicates] },
      })
    }
  })

/** The repeated ingredient ids `mealComponentsSchema` reported, or null if it reported none. */
export function duplicateComponentIds(error: z.ZodError): string[] | null {
  for (const issue of error.issues) {
    if (issue.code !== 'custom') continue
    const ids: unknown = issue.params?.duplicateIds
    if (Array.isArray(ids)) return ids as string[]
  }
  return null
}
