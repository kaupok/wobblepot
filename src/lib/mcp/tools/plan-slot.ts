import 'server-only'

import { z } from 'zod'

import { mealTranslationsInclude, translateMeal } from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { type McpHousehold, ToolInputError } from '@/lib/mcp/context'
import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { cookServingsSelect } from '@/lib/meal-planning/servings'
import { prisma } from '@/lib/prisma'

/**
 * The slot inputs `swap_meal`, `rate_meal`, `adjust_meal`,
 * `change_meal_ingredients`, `clear_meal` and `set_meal_status` share: a day
 * and a meal type, the way `get_meal_plan` reports an entry and the way a
 * user names it ("Thursday's dinner").
 */
export const slotInput = {
  date: z.iso.date().describe('The day, YYYY-MM-DD, as get_meal_plan reports it.'),
  mealType: z.enum(['breakfast', 'lunch', 'dinner']).describe('The meal of that day.'),
}

export type SlotMealType = z.output<typeof slotInput.mealType>

/**
 * The optional entry input the slot tools share (HON-1610): a side's
 * `entryId` from get_meal_plan picks that side, and no `entryId` picks the
 * main.
 */
export const entryIdInput = {
  entryId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional. A side's entryId from get_meal_plan's sides, to act on that side. Omit it to act on the slot's main meal.",
    ),
}

/** How far ahead `plan_meal` and `add_extra` may write, in days after today. */
export const MAX_DAYS_AHEAD = 28

/** Today and the last day a tool may write to, YYYY-MM-DD in the household's timezone. */
export function writableDays(timezone: string): { today: string; lastDay: string } {
  const today = getTodayInTimezone(timezone)
  const lastDay = parseLocalDate(today)
  lastDay.setDate(lastDay.getDate() + MAX_DAYS_AHEAD)
  return { today, lastDay: toDateString(lastDay) }
}

/**
 * The household's plan entry for one day and meal type, with its meal's name
 * in the household's locale. Scoped to the household's own plan, so another
 * household's entry is never found. Throws {@link ToolInputError} when the
 * slot has no entry.
 *
 * Without `entryId` the entry is the slot's main, and `sides` lists its sides.
 * With it, the entry is that one: the main, or one of its sides
 * (`mainEntryId` set, `sides` empty). Any other entry is refused (HON-1610).
 */
export async function findPlanSlot(
  household: McpHousehold,
  date: string,
  mealType: SlotMealType,
  entryId?: string,
) {
  const locale = resolveHouseholdLocale(household)
  const day = parseLocalDate(date)
  const nextDay = new Date(day)
  nextDay.setDate(nextDay.getDate() + 1)

  const select = {
    id: true,
    planId: true,
    mealType: true,
    kind: true,
    mealId: true,
    rating: true,
    // `servingOverride`, `status` and the leftover lunches (HON-1394).
    ...cookServingsSelect,
    meal: {
      select: {
        id: true,
        name: true,
        timeMinutes: true,
        primaryProteinType: true,
        ...mealTranslationsInclude(locale),
      },
    },
  } as const
  const main = await prisma.mealPlanEntry.findFirst({
    where: {
      plan: { householdId: household.id },
      date: { gte: day, lt: nextDay },
      mealType,
      // The slot's main, never one of its sides (HON-1609).
      mainEntryId: null,
    },
    select: {
      ...select,
      sides: { orderBy: { id: 'asc' }, select },
    },
  })

  if (!main) {
    throw new ToolInputError(
      `Nothing is planned for ${mealType} on ${date}. Use get_meal_plan to see which days and meals have an entry. Nothing was changed.`,
    )
  }

  const named = <T extends { meal: Parameters<typeof translateMeal>[0] | null }>(entry: T) => ({
    ...entry,
    mealName: entry.meal ? translateMeal(entry.meal, locale).name : null,
  })
  const sides = main.sides.map(named)

  if (entryId === undefined || entryId === main.id) {
    return { ...named(main), mainEntryId: null, sides }
  }
  const side = sides.find((s) => s.id === entryId)
  if (!side) {
    throw new ToolInputError(
      `${entryId} is not the ${mealType} on ${date} or one of its sides. Use the entryId get_meal_plan returned for that slot. Nothing was changed.`,
    )
  }
  return { ...side, mainEntryId: main.id, sides: [] as typeof sides }
}
