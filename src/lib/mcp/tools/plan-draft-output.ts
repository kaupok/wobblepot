import { z } from 'zod'

import { draftItemSchema, draftSlotsSchema } from '@/lib/meal-plans/draft'

/** The schemas `check_plan` and `apply_plan` share (HON-1652). */

const mealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner'])

export const draftInputSchema = z.object({
  slots: draftSlotsSchema.describe(
    'The slots to change, 1 to 42. Each has date, mealType and exactly one of: mealId (a recipe meal, with optional servings), items (a fridge meal) or clear: true (an empty slot). A slot the draft does not name stays as it is; a slot it names is replaced, whether it is empty, planned or skipped.',
  ),
})

export const problemSchema = z.object({
  date: z.iso.date(),
  mealType: mealTypeSchema,
  code: z.enum([
    'duplicateSlot',
    'outOfRange',
    'cooked',
    'mealNotFound',
    'unsuitable',
    'ruledOut',
    'itemNotFound',
    'notRecipe',
    'side',
    'skipped',
    'notBefore',
    'tooOld',
    'servingsRequired',
    'sourceReplaced',
    'duplicateSource',
  ]),
  message: z.string(),
})

export const warningSchema = z.object({
  code: z.enum(['sameProteinInARow', 'repeatedMeal', 'losesChanges']),
  slots: z.array(z.object({ date: z.iso.date(), mealType: mealTypeSchema })),
  message: z.string(),
})

export const weekSchema = z
  .array(
    z.object({
      date: z.iso.date(),
      slots: z.array(
        z.object({
          date: z.iso.date(),
          mealType: mealTypeSchema,
          changed: z.boolean().describe('True when the draft names this slot.'),
          entryId: z
            .string()
            .nullable()
            .describe(
              'The entry id: null for an empty slot, and for a draft slot not written yet.',
            ),
          kind: z.enum(['recipe', 'fridge', 'empty']),
          status: z.enum(['planned', 'cooked', 'skipped']).nullable(),
          mealId: z.string().nullable(),
          mealName: z.string().nullable(),
          timeMinutes: z.number().nullable(),
          primaryProteinType: z.string().nullable(),
          servings: z.number().nullable().describe("The meal's own servings."),
          cookServings: z
            .number()
            .nullable()
            .describe('Own servings plus the servings its leftover meals take.'),
          items: z.array(draftItemSchema),
        }),
      ),
    }),
  )
  .describe("The draft's days as they will be, every slot of each day.")
