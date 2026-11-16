import 'server-only'

import { z } from 'zod'

import { defineTool, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { applyDraft, draftSlotSchema } from '@/lib/meal-plans/draft'

import { DRAFT_FLOW } from './check-plan'
import { draftInputSchema, problemSchema, warningSchema, weekSchema } from './plan-draft-output'

export const applyPlan = defineTool({
  name: 'apply_plan',
  title: 'Write a draft week',
  description: `Writes a draft of the meal plan, all of it or nothing, after the user agreed to it. ${DRAFT_FLOW} It runs check_plan's check first: with any problem, nothing is written and the problems come back. Each slot the draft names is replaced, with its note, sides and Adjust recipe changes. previous is the changed slots as they were: call apply_plan with previous as slots to undo. Undo brings back each meal, its servings and its leftover links, but not a note, sides or recipe changes, and a skipped meal comes back planned.`,
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false, destructiveHint: true },
  inputSchema: draftInputSchema,
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
  }),
  run: async (household, { slots }) => applyDraft(household, slots),
})
