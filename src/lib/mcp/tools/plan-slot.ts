import 'server-only'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { mealTranslationsInclude, translateMeal } from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { ToolInputError, type McpHousehold } from '@/lib/mcp/context'

/**
 * The slot inputs `swap_meal`, `rate_meal` and `adjust_meal` share: a day and a meal type,
 * the way `get_meal_plan` reports an entry and the way a user names it
 * ("Thursday's dinner").
 */
export const slotInput = {
  date: z.iso.date().describe('The day, YYYY-MM-DD, as get_meal_plan reports it.'),
  mealType: z.enum(['breakfast', 'lunch', 'dinner']).describe('The meal of that day.'),
}

export type SlotMealType = z.output<typeof slotInput.mealType>

/**
 * The household's plan entry for one day and meal type, with its meal's name
 * in the household's locale. Scoped to the household's own plan, so another
 * household's entry is never found. Throws {@link ToolInputError} when the
 * slot has no entry.
 */
export async function findPlanSlot(household: McpHousehold, date: string, mealType: SlotMealType) {
  const locale = resolveHouseholdLocale(household)
  const day = parseLocalDate(date)
  const nextDay = new Date(day)
  nextDay.setDate(nextDay.getDate() + 1)

  const entry = await prisma.mealPlanEntry.findFirst({
    where: {
      plan: { householdId: household.id },
      date: { gte: day, lt: nextDay },
      mealType,
    },
    select: {
      id: true,
      planId: true,
      mealType: true,
      mealId: true,
      status: true,
      rating: true,
      servingOverride: true,
      meal: {
        select: {
          id: true,
          name: true,
          timeMinutes: true,
          primaryProteinType: true,
          ...mealTranslationsInclude(locale),
        },
      },
    },
  })

  if (!entry) {
    throw new ToolInputError(
      `Nothing is planned for ${mealType} on ${date}. Use get_meal_plan to see which days and meals have an entry. Nothing was changed.`,
    )
  }

  return {
    ...entry,
    mealName: entry.meal ? translateMeal(entry.meal, locale).name : null,
  }
}
