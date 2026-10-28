import 'server-only'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { createEntry, EntryCreateError } from '@/lib/meal-plans/create-entry'
import {
  FridgeItemNotFoundError,
  setFridgeItems,
  SetFridgeItemsError,
} from '@/lib/meal-plans/fridge-meal'
import { fridgeItemsSchema } from '@/lib/meal-plans/fridge-items'
import {
  findLeftoverSourceProblem,
  type LeftoverSourceProblem,
  RECENT_MEALS_DAYS,
} from '@/lib/meal-plans/recent-meals'
import { findOrCreateMealPlan } from '@/lib/meal-plans/plans'
import { fridgeItemOutputSchema, toFridgeItemOutput } from '@/lib/api/v1/meal-plan'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { MAX_DAYS_AHEAD, slotInput, writableDays } from './plan-slot'

/**
 * Plans a fridge meal (HON-1281): what the app's fridge-meal picker does, so
 * an assistant can plan "the leftover mash with the frozen veg". Completion
 * stays in the app; the assistant marks used-up items with `set_pantry_status`.
 */
export const planFridgeMeal = defineTool({
  name: 'plan_fridge_meal',
  title: 'Plan a fridge meal',
  description: `Plans a fridge meal: a meal made of what is at home, with no recipe. Each item is a pantry ingredient ({ ingredientId } from get_pantry), leftovers of an earlier recipe meal ({ sourceEntryId, servings }: that meal's entryId from get_meal_plan), or free text ({ label }). The leftovers' meal is in an earlier slot, up to ${RECENT_MEALS_DAYS} days before this one, and not skipped. It may still be planned, such as tonight's dinner for tomorrow's lunch: then servings is required, and that dinner's shopping amounts grow by those servings. For a cooked meal, servings is optional and changes nothing. On an empty slot it plans a new meal. On a slot with a planned meal or a fridge meal it replaces that meal with these items, so confirm with the user first. A cooked meal cannot be changed. The day is any past day, today, or up to ${MAX_DAYS_AHEAD} days ahead. A past day logs the meal as cooked, because the household ate it. This tool does not change the pantry: to mark items used up, use set_pantry_status.`,
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    ...slotInput,
    items: fridgeItemsSchema.describe(
      'The items, in the order to show them. Each has exactly one of ingredientId, sourceEntryId or label. A leftover item may add servings: 0.5 to 20, in steps of 0.5.',
    ),
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['planned', 'replaced'])
      .describe('planned: the slot was empty. replaced: the slot had a meal, now these items.'),
    status: z
      .enum(['planned', 'cooked'])
      .describe('cooked: the day is past, so the meal is logged as eaten.'),
    date: z.iso.date(),
    mealType: z.enum(['breakfast', 'lunch', 'dinner']),
    items: z.array(fridgeItemOutputSchema),
  }),
  run: async (household, { date, mealType, items }) => {
    const { today, lastDay } = writableDays(household.timezone)
    if (date > lastDay) {
      throw new ToolInputError(
        `${date} is more than ${MAX_DAYS_AHEAD} days ahead. Plan a day up to ${lastDay}. Nothing was changed.`,
      )
    }
    // A past day logs a meal the household ate, as `plan_meal` does (HON-1382).
    const status = date < today ? 'completed' : 'planned'

    const day = parseLocalDate(date)
    const entry = await prisma.mealPlanEntry.findFirst({
      where: { plan: { householdId: household.id }, date: day, mealType },
      select: { id: true, planId: true, status: true, mealId: true, note: true, kind: true },
    })
    if (entry?.status === 'completed') {
      throw new ToolInputError(cookedMessage(mealType, date))
    }
    // `toItemRows` accepts any entry of the household, because Edit items and
    // Undo send stored items back, so the source rule runs here. The slot's own
    // entry never passes it: a source must be in an earlier slot.
    const refused = await findLeftoverSourceProblem(household.id, { date, mealType }, items)
    if (refused) {
      throw new ToolInputError(
        `sourceEntryId ${refused.sourceEntryId}: ${SOURCE_PROBLEM_MESSAGES[refused.problem]} Nothing was changed.`,
      )
    }

    // An entry with no meal, no note and no items is a picker placeholder,
    // which `createEntry` replaces (HON-1251).
    const isEmpty =
      !entry || (entry.mealId === null && entry.note === null && entry.kind === 'meal')

    try {
      if (isEmpty) {
        const planId = await findOrCreateMealPlan(household.id)
        await createEntry(household.id, planId, { date: day, mealType, fridgeItems: items, status })
      } else {
        await setFridgeItems(household.id, entry.planId, entry.id, items, status)
      }
    } catch (error) {
      if (error instanceof FridgeItemNotFoundError) {
        throw new ToolInputError(
          "An ingredientId or sourceEntryId is not one this household can use. Use get_pantry for ingredient ids and get_meal_plan for a meal's entryId. Nothing was changed.",
        )
      }
      if (error instanceof SetFridgeItemsError && error.reason === 'completed') {
        throw new ToolInputError(cookedMessage(mealType, date))
      }
      // The slot was filled, or its entry removed, between the read and the write.
      if (
        (error instanceof EntryCreateError && error.reason === 'slotTaken') ||
        (error instanceof SetFridgeItemsError && error.reason === 'entryNotFound')
      ) {
        throw new ToolInputError(
          `The ${mealType} on ${date} changed while this ran. Use get_meal_plan to see it, then try again. Nothing was changed.`,
        )
      }
      throw error
    }

    const nextDay = new Date(day)
    nextDay.setDate(nextDay.getDate() + 1)
    const { entries } = await loadPlanEntries(household, { startDate: day, endDate: nextDay })
    const written = entries.find((planned) => planned.mealType === mealType)
    return {
      outcome: isEmpty ? ('planned' as const) : ('replaced' as const),
      status: status === 'completed' ? ('cooked' as const) : ('planned' as const),
      date,
      mealType,
      items: (written?.items ?? []).map(toFridgeItemOutput),
    }
  },
})

function cookedMessage(mealType: string, date: string): string {
  return `The ${mealType} on ${date} is cooked, so it cannot be changed. Nothing was changed.`
}

const SOURCE_PROBLEM_MESSAGES: Record<LeftoverSourceProblem, string> = {
  notFound: 'no meal of this household has this entryId. Use get_meal_plan for it.',
  notRecipe:
    'leftovers come from a recipe meal (kind recipe in get_meal_plan), not a fridge meal or an empty slot.',
  skipped: 'that meal is skipped, so there are no leftovers. Plan it again first.',
  notBefore: 'leftovers come from a meal in an earlier slot than this one.',
  tooOld: `leftovers come from a meal no more than ${RECENT_MEALS_DAYS} days before this one.`,
  servingsRequired:
    'that meal is not cooked yet, so give servings: how much of it this meal takes. The meal is then cooked and bought for those servings too.',
}
