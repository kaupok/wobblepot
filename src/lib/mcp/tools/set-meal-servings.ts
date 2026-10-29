import 'server-only'

import { z } from 'zod'

import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { getEffectiveServings, sumPortions } from '@/lib/meal-planning/servings'
import { EntryUpdateError, updateEntry } from '@/lib/meal-plans/entries'

import { findPlanSlot, slotInput } from './plan-slot'

const COOKED =
  'This meal is already cooked, and the pantry was charged for its servings then, so they cannot change. Nothing was changed.'

/**
 * Sets how many servings a planned meal is cooked for, or puts it back on the
 * household default (HON-1331): what the servings control in a meal's detail view
 * does (`PATCH …/entries/[entryId]` with `servingOverride`), so an assistant
 * can act on "we have guests on Saturday, make dinner for 6".
 */
export const setMealServings = defineTool({
  name: 'set_meal_servings',
  title: 'Change a meal’s servings',
  description:
    'Sets how many servings a planned recipe meal is cooked for, by day and meal type, or pass servings: null to go back to the household default (get_household gives it). The recipe amounts and the shopping list follow the new count. A fridge meal has no recipe to scale, and a cooked meal cannot change, because the pantry was charged for its servings.',
  annotations: WRITE_ANNOTATIONS,
  inputSchema: z.object({
    ...slotInput,
    // The limits of the PATCH route's `servingOverride`.
    servings: z
      .number()
      .int()
      .min(1)
      .max(20)
      .nullable()
      .describe('Whole servings, 1 to 20. Null: the household default.'),
  }),
  outputSchema: z.object({
    date: z.iso.date(),
    mealType: z.enum(['breakfast', 'lunch', 'dinner']),
    meal: z.object({ id: z.string(), name: z.string() }),
    servings: z
      .number()
      .describe('The servings the meal is now cooked for, as get_meal_plan reports them.'),
    isDefault: z.boolean().describe('True when the meal follows the household default.'),
  }),
  run: async (household, { date, mealType, servings }) => {
    const slot = await findPlanSlot(household, date, mealType)
    if (slot.kind === 'fridge') {
      throw new ToolInputError(
        `The ${mealType} on ${date} is a fridge meal, which has no recipe to scale. Nothing was changed.`,
      )
    }
    if (!slot.mealId) {
      throw new ToolInputError(
        `No meal is planned for ${mealType} on ${date}, so there are no servings to change. Nothing was changed.`,
      )
    }
    // `updateEntry` lets a cooked entry through when the count does not move,
    // so refuse here too: a cooked meal's servings are settled.
    if (slot.status === 'completed') throw new ToolInputError(COOKED)

    try {
      await updateEntry(household.id, slot.planId, slot.id, { servingOverride: servings })
    } catch (error) {
      if (error instanceof EntryUpdateError) {
        throw new ToolInputError(
          error.reason === 'completedServings'
            ? COOKED
            : 'The meal plan changed while this ran. Try again.',
        )
      }
      throw error
    }

    return {
      date,
      mealType,
      meal: { id: slot.mealId, name: slot.mealName! },
      // The same rule `readMealPlan` reports `servings` by.
      servings: getEffectiveServings({ servingOverride: servings }, sumPortions(household.members)),
      isDefault: servings === null,
    }
  },
})
