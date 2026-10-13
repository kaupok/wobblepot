import 'server-only'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { findPlanSlot, slotInput } from './plan-slot'

const ratingSchema = z.enum(['up', 'down']).nullable()

export const rateMeal = defineTool({
  name: 'rate_meal',
  title: 'Rate a cooked meal',
  description:
    'Records what the household thought of a meal they cooked, by day and meal type: up (liked it), down (did not), or null to clear the rating. The same thumbs as in the app, so only a meal marked as cooked can be rated. Ratings move the meal up or down in later swap suggestions.',
  annotations: WRITE_ANNOTATIONS,
  inputSchema: z.object({
    ...slotInput,
    rating: ratingSchema.describe('up, down, or null to clear.'),
  }),
  outputSchema: z.object({
    date: z.iso.date(),
    mealType: z.enum(['breakfast', 'lunch', 'dinner']),
    meal: z.object({ id: z.string(), name: z.string() }),
    rating: ratingSchema,
  }),
  run: async (household, { date, mealType, rating }) => {
    const slot = await findPlanSlot(household, date, mealType)
    if (!slot.mealId) {
      throw new ToolInputError(
        `No meal is planned for ${mealType} on ${date}, so there is nothing to rate. Nothing was changed.`,
      )
    }
    // The app offers the thumbs on a cooked entry only (`MealCard`), and only
    // there can the household see or clear a rating. A rating on any other
    // entry would still move the swap ranking, unseen.
    if (slot.status !== 'completed') {
      throw new ToolInputError(
        `The ${mealType} on ${date} is not marked as cooked, so it cannot be rated yet. The household marks it cooked in Wobblepot first. Nothing was changed.`,
      )
    }

    // The same column write `PATCH /api/meal-plans/[id]/entries/[entryId]`
    // makes for `{ rating }`. Matched on the meal and the status too: a rating
    // is a verdict on the cooked meal the entry points at, so a swap or a
    // revert to planned that lands first must not take this rating (HON-703).
    const [rated] = await prisma.mealPlanEntry.updateManyAndReturn({
      where: { id: slot.id, planId: slot.planId, mealId: slot.mealId, status: 'completed' },
      data: { rating },
    })
    if (!rated) {
      throw new ToolInputError('The meal plan changed while this ran. Try again.')
    }

    return {
      date,
      mealType,
      meal: { id: slot.mealId, name: slot.mealName! },
      rating: rated.rating,
    }
  },
})
