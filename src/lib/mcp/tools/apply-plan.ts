import 'server-only'

import { z } from 'zod'

import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { applyDraft, DraftConflictError, draftSlotSchema } from '@/lib/meal-plans/draft'

import { DRAFT_FLOW } from './check-plan'
import { draftInputSchema, problemSchema, warningSchema, weekSchema } from './plan-draft-output'

export const applyPlan = defineTool({
  name: 'apply_plan',
  title: 'Write a draft week',
  description: `Writes a draft of the meal plan, all of it or nothing, after the user agreed to it. ${DRAFT_FLOW} It runs check_plan's check first: with any problem, nothing is written and the problems come back. Each slot the draft names is replaced, with its note, sides and Adjust recipe changes. previous is the changed slots as they were: to undo, call apply_plan with previous as slots and restoreToken as it came back. Undo brings back each meal, its servings and its leftover links, but not a note, sides or recipe changes, and a skipped meal comes back planned.`,
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false, destructiveHint: true },
  inputSchema: draftInputSchema.extend({
    restoreToken: z
      .string()
      .optional()
      .describe(
        'Only to undo: the restoreToken an earlier apply_plan returned with the previous now sent as slots. It lets leftovers come back whose source changed since they were saved.',
      ),
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['applied', 'refused'])
      .describe('applied: every slot was written. refused: nothing was written, see problems.'),
    problems: z.array(problemSchema).optional().describe('Why the draft was refused.'),
    warnings: z.array(warningSchema),
    week: weekSchema.optional(),
    previous: z
      .array(draftSlotSchema)
      .optional()
      .describe('The changed slots as they were. Send them as slots to apply_plan to undo.'),
    restoreToken: z
      .string()
      .optional()
      .describe('Send it with previous to undo. It matches only these slots, unchanged.'),
  }),
  run: async (household, { slots, restoreToken }) => {
    try {
      return await applyDraft(household, slots, restoreToken)
    } catch (error) {
      if (!(error instanceof DraftConflictError)) throw error
      throw new ToolInputError(
        'A slot of this draft changed while this ran, such as a meal marked cooked. Use get_meal_plan, then check_plan again. Nothing was changed.',
      )
    }
  },
})
