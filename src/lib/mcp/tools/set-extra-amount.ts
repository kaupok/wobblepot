import 'server-only'

import { z } from 'zod'

import { dayExtraOutputSchema, toDayExtraOutput } from '@/lib/api/v1/meal-plan'
import { findDayExtra, updateDayExtraQuantity } from '@/lib/day-extras/day-extras'
import { dayExtraQuantitySchema } from '@/lib/day-extras/schemas'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'

import { MEASURED_UNITS } from './measured-units'

const NOT_FOUND = 'No extra with this id. Use get_meal_plan to find it. Nothing was changed.'
const FREE_TEXT =
  'A free-text extra has no amount. To give it one, use remove_extra, then add_extra with a name Wobblepot matches. Nothing was changed.'

export const setExtraAmount = defineTool({
  name: 'set_extra_amount',
  title: 'Change the amount of an extra',
  description:
    'Sets the amount of one extra, by the id get_meal_plan gives in extras, or clears it with quantity null. Give quantity in the unit get_meal_plan shows for the extra; the tool does not convert, so convert first: 2 bottles of wine is 1500 ml. An extra with no amount shows no unit: use ml for a drink or other liquid, piece for an item counted in the app, such as eggs, and g for the rest; a wrong unit is refused with the right one named, and nothing changes. The shopping list follows the new amount. A free-text extra has no amount.',
  annotations: WRITE_ANNOTATIONS,
  inputSchema: z
    .object({
      extraId: z.string().min(1).describe('The extra to change, from get_meal_plan.'),
      quantity: dayExtraQuantitySchema.describe(
        'The new amount in unit, or null to clear the amount.',
      ),
      unit: z
        .enum(MEASURED_UNITS)
        .optional()
        .describe('The unit get_meal_plan shows for this extra. Leave out when quantity is null.'),
    })
    .refine((i) => (i.quantity === null) === (i.unit === undefined), {
      message: 'Give quantity and unit together, or quantity null and no unit.',
    }),
  outputSchema: dayExtraOutputSchema,
  run: async (household, { extraId, quantity, unit }) => {
    const extra = await findDayExtra(household, extraId)
    if (!extra) throw new ToolInputError(NOT_FOUND)
    if (extra.unit === null) throw new ToolInputError(FREE_TEXT)
    // `quantity` is stored in the ingredient's `defaultUnit` and shown in
    // `extra.unit`; 1 g is 1 ml, so the shown unit's number is the stored one,
    // as the app's amount field sends it. Any other unit would need a guess.
    if (unit !== undefined && unit !== extra.unit) {
      throw new ToolInputError(
        `This extra is measured in ${extra.unit}. Send the amount in ${extra.unit}. Nothing was changed.`,
      )
    }

    const outcome = await updateDayExtraQuantity(household, extraId, quantity)
    if (outcome.status === 'not_found') throw new ToolInputError(NOT_FOUND)
    if (outcome.status === 'free_text') throw new ToolInputError(FREE_TEXT)
    return toDayExtraOutput(outcome.extra)
  },
})
