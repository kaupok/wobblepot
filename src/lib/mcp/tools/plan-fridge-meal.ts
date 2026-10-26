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
  description: `Plans a fridge meal: a meal made of what is at home, with no recipe. Each item is a pantry ingredient ({ ingredientId } from get_pantry), the leftovers of a meal cooked earlier ({ sourceEntryId }: that meal's entryId from get_meal_plan), or free text ({ label }). On an empty slot it plans a new meal. On a slot with a planned meal or a fridge meal it replaces that meal with these items, so confirm with the user first. A cooked meal cannot be changed. The day is today or up to ${MAX_DAYS_AHEAD} days ahead. This tool does not change the pantry: to mark items used up, use set_pantry_status.`,
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    ...slotInput,
    items: fridgeItemsSchema.describe(
      'The items, in the order to show them. Each has exactly one of ingredientId, sourceEntryId or label.',
    ),
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['planned', 'replaced'])
      .describe('planned: the slot was empty. replaced: the slot had a meal, now these items.'),
    date: z.iso.date(),
    mealType: z.enum(['breakfast', 'lunch', 'dinner']),
    items: z.array(fridgeItemOutputSchema),
  }),
  run: async (household, { date, mealType, items }) => {
    const { today, lastDay } = writableDays(household.timezone)
    if (date < today) {
      throw new ToolInputError(
        `${date} is in the past, so a meal cannot be planned for it. Nothing was changed.`,
      )
    }
    if (date > lastDay) {
      throw new ToolInputError(
        `${date} is more than ${MAX_DAYS_AHEAD} days ahead. Plan a day from today to ${lastDay}. Nothing was changed.`,
      )
    }

    const day = parseLocalDate(date)
    const entry = await prisma.mealPlanEntry.findFirst({
      where: { plan: { householdId: household.id }, date: day, mealType },
      select: { id: true, planId: true, status: true, mealId: true, note: true, kind: true },
    })
    if (entry?.status === 'completed') {
      throw new ToolInputError(cookedMessage(mealType, date))
    }
    // An entry with no meal, no note and no items is a picker placeholder,
    // which `createEntry` replaces (HON-1251).
    const isEmpty =
      !entry || (entry.mealId === null && entry.note === null && entry.kind === 'meal')

    try {
      if (isEmpty) {
        const planId = await findOrCreateMealPlan(household.id)
        await createEntry(household.id, planId, { date: day, mealType, fridgeItems: items })
      } else {
        await setFridgeItems(household.id, entry.planId, entry.id, items)
      }
    } catch (error) {
      if (error instanceof FridgeItemNotFoundError) {
        throw new ToolInputError(
          "An ingredientId or sourceEntryId is not one this household can use. Use get_pantry for ingredient ids and get_meal_plan for a cooked meal's entryId. Nothing was changed.",
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
      date,
      mealType,
      items: (written?.items ?? []).map(toFridgeItemOutput),
    }
  },
})

function cookedMessage(mealType: string, date: string): string {
  return `The ${mealType} on ${date} is cooked, so it cannot be changed. Nothing was changed.`
}
