import 'server-only'

import { z } from 'zod'

import { mealTranslationsInclude, translateMeal } from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { createEntry, EntryCreateError } from '@/lib/meal-plans/create-entry'
import { createSide, SideCreateError, type SideCreateRefusal } from '@/lib/meal-plans/create-side'
import { findLastPlannedDate, findNextPlannedDate } from '@/lib/meal-plans/last-planned'
import { findOrCreateMealPlan } from '@/lib/meal-plans/plans'
import { prisma } from '@/lib/prisma'

import { assertMealFitsSlot } from './meal-fit'
import { MAX_DAYS_AHEAD, slotInput, writableDays } from './plan-slot'

export const planMeal = defineTool({
  name: 'plan_meal',
  title: 'Plan a meal',
  description: `Puts one meal the user chose in an empty slot: a day and meal type with no meal yet. Use it to plan from the household's rotation: list_meals with source own or favourites gives the ids. For today or a later day, the meal must suit the meal type and fit the household's diet, allergens and avoided ingredients. A meal planned recently or on a later day is allowed; lastPlannedOn and nextPlannedOn say when it was last planned and when it is planned next, so you can mention the repeat. The day is any past day, today, or up to ${MAX_DAYS_AHEAD} days ahead. A past day logs the meal as cooked, because the household ate it, and does not change the pantry; it takes any meal the household can see, whatever its meal type or diet. To change a slot that has a meal, use swap_meal. With role side, the meal is a side dish added to the slot's main, which must be a recipe or a fridge meal: a slot can hold any number of sides, but one recipe only once. A side of a cooked main is logged as eaten and does not change the pantry; a side of a skipped slot is refused. A side is cooked, skipped and cleared with its main. servings sets the meal's own servings; a side without servings follows its main's servings.`,
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    ...slotInput,
    mealId: z.string().min(1).describe('The meal to plan, from list_meals.'),
    role: z
      .enum(['main', 'side'])
      .optional()
      .describe(
        'main (default): the slot must be empty. side: add the meal as a side dish to the meal already planned in the slot.',
      ),
    // The limits of the PATCH route's `servingOverride`.
    servings: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe(
        "Whole servings, 1 to 20. Omit it for the household default, or for a side, its main's servings.",
      ),
  }),
  outputSchema: z.object({
    outcome: z.literal('planned'),
    role: z.enum(['main', 'side']),
    entryId: z.string().describe("The new entry's id; get_meal_plan lists a side under its main."),
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
    nextPlannedOn: z.iso
      .date()
      .nullable()
      .describe('The earliest later day this meal is planned, or null if none.'),
  }),
  run: async (household, { date, mealType, mealId, role = 'main', servings }) => {
    const { today, lastDay } = writableDays(household.timezone)
    if (date > lastDay) {
      throw new ToolInputError(
        `${date} is more than ${MAX_DAYS_AHEAD} days ahead. Plan a day up to ${lastDay}. Nothing was changed.`,
      )
    }
    // A past day logs a meal the household ate (HON-1382). The pantry stays as
    // it is: the household has shopped and adjusted it since. The entry is
    // saved as already charged, so a later planned → cooked never charges it
    // (HON-1391).
    const isPast = date < today

    await assertMealFitsSlot(household, mealId, mealType, isPast ? 'logged' : 'planned')

    const planId = await findOrCreateMealPlan(household.id)
    const lastPlannedOn = await findLastPlannedDate(household.id, mealId, date)
    const nextPlannedOn = await findNextPlannedDate(household.id, mealId, date)
    // Read before the write: a refusal of a side names the meal.
    const locale = resolveHouseholdLocale(household)
    const named = await prisma.meal.findUniqueOrThrow({
      where: { id: mealId },
      select: { name: true, ...mealTranslationsInclude(locale) },
    })
    const mealName = translateMeal(named, locale).name
    let created: { id: string; status: string }
    if (role === 'side') {
      try {
        created = await createSide(household.id, planId, {
          date: parseLocalDate(date),
          mealType,
          mealId,
          servingOverride: servings,
        })
      } catch (error) {
        if (!(error instanceof SideCreateError)) throw error
        throw new ToolInputError(sideRefusal(error.reason, mealType, date, mealName))
      }
    } else {
      created = await planMain(household.id, planId, date, mealType, mealId, isPast, servings)
    }

    return {
      outcome: 'planned' as const,
      role,
      entryId: created.id,
      status: created.status === 'completed' ? ('cooked' as const) : ('planned' as const),
      date,
      mealType,
      meal: { id: mealId, name: mealName },
      lastPlannedOn,
      nextPlannedOn,
    }
  },
})

function sideRefusal(
  reason: SideCreateRefusal,
  mealType: string,
  date: string,
  mealName: string,
): string {
  switch (reason) {
    case 'noMain':
      return `The ${mealType} on ${date} has no meal to add a side to. Plan the main first with plan_meal. Nothing was changed.`
    case 'mainSkipped':
      return `This slot was skipped: the ${mealType} on ${date}. Set it back to planned with set_meal_status first. Nothing was changed.`
    case 'alreadyInSlot':
      return `${mealName} is already in this slot: the ${mealType} on ${date}. Nothing was changed.`
    case 'mealNotFound':
      return 'This meal was deleted while this ran. Use list_meals to find another. Nothing was changed.'
  }
}

async function planMain(
  householdId: string,
  planId: string,
  date: string,
  mealType: 'breakfast' | 'lunch' | 'dinner',
  mealId: string,
  isPast: boolean,
  servings: number | undefined,
) {
  try {
    return await createEntry(householdId, planId, {
      date: parseLocalDate(date),
      mealType,
      mealId,
      status: isPast ? 'completed' : 'planned',
      pantryDeducted: isPast,
      servingOverride: servings ?? null,
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
}
