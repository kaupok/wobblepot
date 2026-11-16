import 'server-only'

import { z } from 'zod'

import { defineTool } from '@/lib/mcp/context'
import { MAX_DAYS_AHEAD } from '@/lib/meal-planning/writable-days'
import { checkDraft } from '@/lib/meal-plans/draft'

import { draftInputSchema, problemSchema, warningSchema, weekSchema } from './plan-draft-output'

/** The flow both draft tools describe, so the assistant writes only what the user agreed to. */
export const DRAFT_FLOW = `To plan a week: read the household (get_household), the plan (get_meal_plan), the meals (list_meals) and the pantry (get_pantry); draft the week; call check_plan; show the user the week and the needs; change the draft from what the user says and check it again; call apply_plan only after the user agrees.`

export const checkPlan = defineTool({
  name: 'check_plan',
  title: 'Check a draft week',
  description: `Checks a draft of the meal plan against the household's rules, and changes nothing. ${DRAFT_FLOW} A draft names slots from today up to ${MAX_DAYS_AHEAD} days ahead. A fridge meal can take leftovers from a recipe meal in the same draft with leftoverOf { date, mealType }, such as Tuesday's lunch from Monday's dinner; that dinner then cooks for the lunch's servings too. Any problem means apply_plan refuses the whole draft; a warning does not. needs is what the draft's recipe meals need and what the pantry says of each; it is not the shopping list.`,
  inputSchema: draftInputSchema,
  outputSchema: z.object({
    problems: z
      .array(problemSchema)
      .describe('Fix each before apply_plan; empty when the draft can be written.'),
    warnings: z.array(warningSchema).describe('Tell the user; apply_plan still writes.'),
    needs: z.array(
      z.object({
        ingredientId: z.string(),
        name: z.string(),
        quantity: z.number().describe('The total at cook servings, in unit.'),
        unit: z.enum(['g', 'ml', 'piece']),
        isVague: z.boolean().describe('A vague amount: phrase says it, and quantity is a guess.'),
        phrase: z.string().nullable(),
        firstNeededOn: z.iso.date(),
        mealCount: z.number(),
        pantry: z.object({
          status: z
            .enum(['none', 'haveIt', 'low', 'ranOut'])
            .describe('none: not in the pantry. haveIt, low, ranOut: as the pantry marks it.'),
          quantity: z
            .number()
            .nullable()
            .describe('The amount at home in unit, when the pantry records one.'),
        }),
      }),
    ),
    week: weekSchema,
  }),
  run: async (household, { slots }) => checkDraft(household, slots),
})
