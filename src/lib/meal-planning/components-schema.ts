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

/**
 * Upper bound on one ingredient's quantity per serving, in its `defaultUnit`
 * (grams, or pieces): 5 kg of one thing per person is a typo, not a recipe.
 */
export const MAX_QUANTITY_PER_SERVING = 5000

/**
 * The body of `POST /api/meal-plans/[id]/entries/[entryId]/components`
 * (HON-1243): replace an ingredient (both ids and a quantity), leave one out
 * (the original only), or add one (the replacement and a quantity).
 */
export const entryChangeSchema = z
  .object({
    originalIngredientId: z.string().min(1).max(100).nullish(),
    replacementIngredientId: z.string().min(1).max(100).nullish(),
    quantityPerServing: z.number().positive().max(MAX_QUANTITY_PER_SERVING).nullish(),
  })
  .superRefine((change, ctx) => {
    const original = change.originalIngredientId ?? null
    const replacement = change.replacementIngredientId ?? null
    const quantity = change.quantityPerServing ?? null
    if (original === null && replacement === null) {
      ctx.addIssue({ code: 'custom', message: 'Name the original, the replacement, or both' })
    }
    if (replacement !== null && quantity === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['quantityPerServing'],
        message: 'A replacement or an added ingredient needs a quantity',
      })
    }
    if (replacement === null && quantity !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['quantityPerServing'],
        message: 'A left-out ingredient has no quantity',
      })
    }
    if (original !== null && original === replacement) {
      ctx.addIssue({
        code: 'custom',
        path: ['replacementIngredientId'],
        message: 'The replacement is the original',
      })
    }
  })
  .transform((change) => ({
    originalIngredientId: change.originalIngredientId ?? null,
    replacementIngredientId: change.replacementIngredientId ?? null,
    quantityPerServing: change.quantityPerServing ?? null,
  }))

export type EntryChangeInput = z.output<typeof entryChangeSchema>

/** Upper bound on an "Adjust recipe" instruction, in characters (HON-1244). */
export const ADJUST_INSTRUCTION_MAX_LENGTH = 500

/**
 * The body of `PUT /api/meal-plans/[id]/entries/[entryId]/components`
 * (HON-1244): the entry's whole change set, which replaces the stored one, and
 * the instruction it came from. Each change is shaped as the POST's; the rules
 * across the set (one change per original, no ingredient twice) need the meal,
 * so `replaceEntryChanges` checks them.
 */
export const entryChangeSetSchema = z.object({
  changes: z.array(entryChangeSchema).max(MAX_MEAL_COMPONENTS),
  adjustmentNote: z
    .string()
    .trim()
    .max(ADJUST_INSTRUCTION_MAX_LENGTH)
    .nullish()
    .transform((note) => note || null),
})

export type EntryChangeSetInput = z.output<typeof entryChangeSetSchema>
