/**
 * Case shapes for the model benchmark (HON-795), one Zod schema per task.
 *
 * Every case is synthetic. Never copy one from `.ai-samples/`: those files hold
 * real users' free text and are gitignored for that reason.
 *
 * Dates are `YYYY-MM-DD` strings, parsed with `parseLocalDate` when the request
 * is built, so a case means the same local dates on every machine.
 */

import { z } from 'zod'
import {
  DietaryType,
  IngredientCategory,
  MealType,
  ProteinType,
} from '../../src/generated/prisma/enums'
import { KNOWN_LOCALES } from '../../src/lib/i18n/locales'

export const TASKS = ['plan', 'recipe', 'imagine', 'review', 'tips'] as const
export type Task = (typeof TASKS)[number]

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')
const locale = z.enum(KNOWN_LOCALES)
const mealType = z.enum(MealType)

/** `CandidateMeal` from `src/lib/meal-planning/candidates.ts`. */
const candidateMeal = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kidFriendly: z.boolean(),
  primaryProteinType: z.enum(ProteinType),
  topIngredients: z.array(z.object({ name: z.string(), category: z.enum(IngredientCategory) })),
  isFavorite: z.boolean(),
  isCustom: z.boolean(),
  netRating: z.number().optional(),
})

export const PlanCaseSchema = z.object({
  /** Inclusive. */
  startDate: dateString,
  /** Exclusive, as in `GeneratePlanOptions`. */
  endDate: dateString,
  weekdayMealTypes: z.array(mealType),
  weekendMealTypes: z.array(mealType),
  dietaryType: z.enum(DietaryType).nullable(),
  restrictions: z.array(z.string()),
  pantryIngredients: z.array(z.string()),
  locale,
  candidatePools: z.object({
    fish: z.array(candidateMeal),
    legume: z.array(candidateMeal),
    any: z.array(candidateMeal),
  }),
  /** Keyed by meal type; becomes the `Map` the builder takes. */
  candidatesByMealType: z.partialRecord(mealType, z.array(candidateMeal)),
})

export const RecipeCaseSchema = z.object({
  text: z.string().min(1),
  locale,
  expected: z.object({
    /**
     * Names are in the **output** language: the parser answers in the
     * household locale, so an Estonian case expects Estonian names.
     */
    ingredients: z
      .array(
        z.object({
          /** Accepted aliases, matched lowercased and trimmed. */
          names: z.array(z.string().min(1)).min(1),
          quantity: z.number().nullable(),
          unit: z.string().nullable(),
        }),
      )
      .min(1),
    lowConfidence: z.boolean(),
    stepCount: z.number().int().positive().optional(),
  }),
})

export const ImagineCaseSchema = z.object({
  prompt: z.string().min(1),
  /** `HouseholdContext` from `src/lib/ai/imagine-request.ts`. */
  household: z.object({
    allergens: z.array(z.string()),
    dietaryType: z.string().nullable(),
    excludedIngredients: z.array(z.string()),
    restrictions: z.array(z.string()),
    householdSize: z.number().int().positive(),
  }),
  locale,
  /** No ingredient name may contain one of these, case-insensitive. */
  forbiddenKeywords: z.array(z.string().min(1)),
})

const reviewExpectation = z.union([
  z.object({ quantityPerServing: z.number().positive() }).strict(),
  z.object({ unchanged: z.literal(true) }).strict(),
])

export const ReviewCaseSchema = z
  .object({
    mealName: z.string().min(1),
    servings: z.number().int().positive(),
    /** `ReviewIngredient` from `src/lib/ai/review-request.ts`. */
    ingredients: z
      .array(
        z.object({
          ingredientId: z.string().min(1),
          name: z.string().min(1),
          quantityPerServing: z.number().positive(),
          unit: z.enum(['g', 'piece']),
        }),
      )
      .min(1),
    locale,
    /**
     * Keyed by `ingredientId`: either the corrected per-serving quantity for a
     * seeded error, or `{ "unchanged": true }` for a quantity that must be kept.
     */
    expected: z.record(z.string(), reviewExpectation),
  })
  .superRefine((c, ctx) => {
    const ids = new Set(c.ingredients.map((i) => i.ingredientId))
    for (const key of Object.keys(c.expected)) {
      if (!ids.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['expected', key],
          message: `No input ingredient has ingredientId "${key}"`,
        })
      }
    }
  })

const tipsComponent = z.object({
  name: z.string().min(1),
  quantityPerServing: z.number().positive(),
  defaultUnit: z.string().min(1),
})

const tipsBase = {
  mealName: z.string().min(1),
  servings: z.number().int().positive(),
  timeMinutes: z.number().int().positive().nullable(),
  components: z.array(tipsComponent).min(1),
  locale,
}

export const TipsCaseSchema = z.discriminatedUnion('kind', [
  z.object({ ...tipsBase, kind: z.literal('full') }),
  z.object({ ...tipsBase, kind: z.literal('supplementary'), preparationNotes: z.string().min(1) }),
])

export const CASE_SCHEMAS = {
  plan: PlanCaseSchema,
  recipe: RecipeCaseSchema,
  imagine: ImagineCaseSchema,
  review: ReviewCaseSchema,
  tips: TipsCaseSchema,
} as const satisfies Record<Task, z.ZodType>

export type PlanCase = z.infer<typeof PlanCaseSchema>
export type RecipeCase = z.infer<typeof RecipeCaseSchema>
export type ImagineCase = z.infer<typeof ImagineCaseSchema>
export type ReviewCase = z.infer<typeof ReviewCaseSchema>
export type TipsCase = z.infer<typeof TipsCaseSchema>

interface CaseInputs {
  plan: PlanCase
  recipe: RecipeCase
  imagine: ImagineCase
  review: ReviewCase
  tips: TipsCase
}

/**
 * A validated case file. `task` comes from its directory and `id` from its
 * file name (`cases/recipe/en-lasagne.json` → `recipe/en-lasagne`), so neither
 * is repeated inside the JSON.
 */
export type BenchCase = {
  [T in Task]: { task: T; id: string; input: CaseInputs[T] }
}[Task]

export type CaseOf<T extends Task> = Extract<BenchCase, { task: T }>
