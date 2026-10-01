/**
 * Case shapes for the model benchmark (HON-795), one Zod schema per task.
 *
 * Every committed case is synthetic. `pnpm bench:models --import-sample` turns
 * a production `[ai-sample]` line into `cases/<task>/<slug>.draft.json`, which
 * holds a real household's text: it is gitignored and never loaded, and its
 * text is rewritten before it becomes a case (`cases/README.md`, HON-903).
 *
 * Each case schema is strict at the top level, so a renamed draft that still
 * carries its `sampleInput` or `sampleOutput` fails to load rather than
 * committing them.
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

/**
 * Where the case came from: the issue whose AI output bug it reproduces
 * (`"HON-895"`), or `"ai-sample"` for one imported from production. Omitted on
 * a synthetic coverage case. Bookkeeping only: no scorer reads it and the
 * judge never sees it.
 */
const source = z.string().min(1).optional()

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

export const PlanCaseSchema = z.strictObject({
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
  source,
})

export const RecipeCaseSchema = z.strictObject({
  text: z.string().min(1),
  locale,
  expected: z
    .object({
      /**
       * Names are in the **output** language: the parser answers in the
       * household locale, so an Estonian case expects Estonian names.
       *
       * Empty only for a not-a-recipe case (`lowConfidence: true`): the parse
       * is rejected, so there is nothing to recall, and recall, precision and
       * quantity match are not scored for it (HON-840).
       */
      ingredients: z.array(
        z.object({
          /** Accepted aliases, matched lowercased and trimmed. */
          names: z.array(z.string().min(1)).min(1),
          quantity: z.number().nullable(),
          unit: z.string().nullable(),
        }),
      ),
      lowConfidence: z.boolean(),
      stepCount: z.number().int().positive().optional(),
    })
    .superRefine((e, ctx) => {
      if (e.ingredients.length === 0 && !e.lowConfidence) {
        ctx.addIssue({
          code: 'custom',
          path: ['ingredients'],
          message: 'Only a lowConfidence case may expect no ingredients',
        })
      }
    }),
  source,
})

export const ImagineCaseSchema = z.strictObject({
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
  /**
   * Foods this case forbids on top of the household's allergens and dietary
   * type, which `src/lib/ai/forbidden-foods.ts` already covers for the scorer
   * and the production guard alike (HON-895). Use it for excluded ingredients
   * and for a food the shared lists lack; a food every household with that
   * allergen or diet must avoid belongs in the shared lists instead.
   * No ingredient name may contain one of these, case-insensitive.
   */
  forbiddenKeywords: z.array(z.string().min(1)).optional(),
  /**
   * Excuses a `forbiddenKeywords` match as a swap when one of these
   * (case-insensitive, starting a word) contains the keyword or sits directly
   * before it: "vegan parmesan", "eggplant" for "egg". Applies to this case's
   * own keywords only; the shared lists carry their own qualifiers. The rule
   * is `findUnexcusedKeyword` in `src/lib/ai/forbidden-foods.ts` (HON-841).
   */
  allowedQualifiers: z.array(z.string().min(1)).optional(),
  source,
})

const reviewExpectation = z.union([
  z.object({ quantityPerServing: z.number().positive() }).strict(),
  z
    .object({ min: z.number().positive(), max: z.number().positive() })
    .strict()
    .refine((r) => r.min <= r.max, 'min must not exceed max'),
  z.object({ unchanged: z.literal(true) }).strict(),
])

export const ReviewCaseSchema = z
  .strictObject({
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
     * Keyed by `ingredientId`. A seeded error takes either the corrected
     * per-serving quantity (accepted within ±25%) or a `{ "min", "max" }`
     * range. Use the range whenever the review prompt's own reference table
     * gives one for that ingredient, so an answer at either end of it passes.
     * `{ "unchanged": true }` marks a quantity that must be kept exactly.
     */
    expected: z.record(z.string(), reviewExpectation),
    source,
  })
  .superRefine((c, ctx) => {
    // An empty expectation would make both review metrics inapplicable: the
    // case would cost a call and measure nothing. An imported draft starts
    // with `{}`, so this is what stops one loading unwritten (HON-903).
    if (Object.keys(c.expected).length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected'],
        message: 'A review case expects at least one ingredient (a seeded error or unchanged)',
      })
    }
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
  source,
}

export const TipsCaseSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...tipsBase, kind: z.literal('full') }),
  z.strictObject({
    ...tipsBase,
    kind: z.literal('supplementary'),
    preparationNotes: z.string().min(1),
  }),
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
