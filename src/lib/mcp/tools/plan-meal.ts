import 'server-only'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { createEntry, EntryCreateError } from '@/lib/meal-plans/create-entry'
import { findLastPlannedDate } from '@/lib/meal-plans/last-planned'
import { findOrCreateMealPlan } from '@/lib/meal-plans/plans'
import { mealTranslationsInclude, translateMeal } from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { assertMealFitsSlot } from './meal-fit'
import { MAX_DAYS_AHEAD, slotInput, writableDays } from './plan-slot'

export const planMeal = defineTool({
  name: 'plan_meal',
  title: 'Plan a meal',
  description: `Puts one meal the user chose in an empty slot: a day and meal type with no meal yet. Use it to plan from the household's rotation: list_meals with source own or favourites gives the ids. The meal must suit the meal type and fit the household's diet, allergens and avoided ingredients. A meal planned recently is allowed; lastPlannedOn says when it was last planned, so you can mention the repeat. The day is any past day, today, or up to ${MAX_DAYS_AHEAD} days ahead. A past day logs the meal as cooked, because the household ate it, and does not change the pantry. To change a slot that has a meal, use swap_meal.`,
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    ...slotInput,
    mealId: z.string().min(1).describe('The meal to plan, from list_meals.'),
  }),
  outputSchema: z.object({
    outcome: z.literal('planned'),
    status: z
      .enum(['planned', 'cooked'])
      .describe('cooked: the day is past, so the meal is logged as eaten.'),
    date: z.iso.date(),
    mealType: z.enum(['breakfast', 'lunch', 'dinner']),
    meal: z.object({ id: z.string(), name: z.string() }),
    lastPlannedOn: z.iso
      .date()
      .nullable()
      .describe('The latest earlier day this meal was planned, or null if never.'),
  }),
  run: async (household, { date, mealType, mealId }) => {
    const { today, lastDay } = writableDays(household.timezone)
    if (date > lastDay) {
      throw new ToolInputError(
        `${date} is more than ${MAX_DAYS_AHEAD} days ahead. Plan a day up to ${lastDay}. Nothing was changed.`,
      )
    }
    // A past day logs a meal the household ate (HON-1382). The pantry stays as
    // it is: the household has shopped and adjusted it since.
    const isPast = date < today

    await assertMealFitsSlot(household, mealId, mealType, isPast ? 'logged' : 'planned')

    const planId = await findOrCreateMealPlan(household.id)
    const lastPlannedOn = await findLastPlannedDate(household.id, mealId, date)
    try {
      await createEntry(household.id, planId, {
        date: parseLocalDate(date),
        mealType,
        mealId,
        status: isPast ? 'completed' : 'planned',
      })
    } catch (error) {
      // `planNotFound` cannot happen for the plan found above, so it stays a failure.
      if (!(error instanceof EntryCreateError) || error.reason === 'planNotFound') throw error
      throw new ToolInputError(
        error.reason === 'slotTaken'
          ? `The ${mealType} on ${date} has a meal, a note or a fridge meal already. Use swap_meal to change it. Nothing was changed.`
          : 'This meal was deleted while this ran. Use list_meals to find another. Nothing was changed.',
      )
    }

    const locale = resolveHouseholdLocale(household)
    const named = await prisma.meal.findUniqueOrThrow({
      where: { id: mealId },
      select: { name: true, ...mealTranslationsInclude(locale) },
    })
    return {
      outcome: 'planned' as const,
      status: isPast ? ('cooked' as const) : ('planned' as const),
      date,
      mealType,
      meal: { id: mealId, name: translateMeal(named, locale).name },
      lastPlannedOn,
    }
  },
})
