import 'server-only'
import { z } from 'zod'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { deleteEntry } from '@/lib/meal-plans/entries'
import { fridgeItemOutputSchema, toFridgeItemOutput } from '@/lib/api/v1/meal-plan'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { findPlanSlot, slotInput } from './plan-slot'

/**
 * Takes a meal off the plan (HON-1329): what Clear on a planner card does
 * (`DELETE /api/meal-plans/[id]/entries/[entryId]`), so an assistant can act
 * on "we eat out on Friday" or undo a `plan_meal` it got wrong.
 */
export const clearMeal = defineTool({
  name: 'clear_meal',
  title: 'Clear a planned meal',
  description:
    'Takes a planned meal off the plan, by day and meal type, and leaves the slot empty. Its ingredients leave the shopping list. The entry’s note, servings and ingredient changes go with it, so confirm with the user before you call this. A cooked meal cannot be cleared. To put a different meal in the slot, use swap_meal instead.',
  // Destructive: nothing restores the entry's note, servings, rating or
  // ingredient changes.
  annotations: { ...WRITE_ANNOTATIONS, destructiveHint: true, idempotentHint: false },
  inputSchema: z.object(slotInput),
  outputSchema: z.object({
    outcome: z.literal('cleared'),
    date: z.iso.date(),
    mealType: z.enum(['breakfast', 'lunch', 'dinner']),
    kind: z
      .enum(['recipe', 'fridge'])
      .describe('recipe: a meal from a recipe. fridge: a meal made of items at home.'),
    meal: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .describe(
        'The recipe meal that was cleared, to plan again with plan_meal. Null for a fridge meal.',
      ),
    items: z
      .array(fridgeItemOutputSchema)
      .describe(
        'The fridge meal’s items, to plan again with plan_fridge_meal. Empty for a recipe meal.',
      ),
  }),
  run: async (household, { date, mealType }) => {
    const slot = await findPlanSlot(household, date, mealType)
    const isFridge = slot.kind === 'fridge'
    if (!isFridge && !slot.mealId) {
      throw new ToolInputError(
        `No meal is planned for ${mealType} on ${date}, so there is nothing to clear. Nothing was changed.`,
      )
    }
    // The app offers Clear only on a card that is not cooked (`MealCard`): a
    // cooked entry records what the pantry was charged for, and its leftovers
    // can be in a fridge meal.
    if (slot.status === 'completed') {
      throw new ToolInputError(
        `The ${mealType} on ${date} is cooked, so it cannot be cleared. Nothing was changed.`,
      )
    }

    // Read before the delete, because the items go with the entry.
    let items: z.output<typeof fridgeItemOutputSchema>[] = []
    if (isFridge) {
      const day = parseLocalDate(date)
      const nextDay = new Date(day)
      nextDay.setDate(nextDay.getDate() + 1)
      const { entries } = await loadPlanEntries(household, { startDate: day, endDate: nextDay })
      const planned = entries.find((entry) => entry.id === slot.id)
      items = (planned?.items ?? []).map(toFridgeItemOutput)
    }

    if (!(await deleteEntry(household.id, slot.planId, slot.id))) {
      throw new ToolInputError('The meal plan changed while this ran. Try again.')
    }

    return {
      outcome: 'cleared' as const,
      date,
      mealType,
      kind: isFridge ? ('fridge' as const) : ('recipe' as const),
      meal: isFridge || !slot.mealId ? null : { id: slot.mealId, name: slot.mealName! },
      items,
    }
  },
})
