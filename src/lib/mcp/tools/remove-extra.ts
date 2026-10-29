import 'server-only'

import { z } from 'zod'

import { deleteDayExtra } from '@/lib/day-extras/day-extras'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'

export const removeExtra = defineTool({
  name: 'remove_extra',
  title: 'Remove an extra from a day',
  description:
    'Removes one extra from its day, by the id get_meal_plan gives in extras. An ingredient extra leaves the shopping list with it. A free-text extra’s shopping item stays on the list, as Remove in the app leaves it.',
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    extraId: z.string().min(1).describe('The extra to remove, from get_meal_plan.'),
  }),
  outputSchema: z.object({
    outcome: z.literal('removed'),
    extraId: z.string(),
  }),
  run: async (household, { extraId }) => {
    const { status } = await deleteDayExtra(household.id, extraId)
    if (status === 'not_found') {
      throw new ToolInputError(
        'No extra with this id. Use get_meal_plan to find it. Nothing was changed.',
      )
    }
    return { outcome: 'removed' as const, extraId }
  },
})
