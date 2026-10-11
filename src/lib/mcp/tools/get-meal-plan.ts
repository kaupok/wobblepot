import 'server-only'
import { z } from 'zod'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { getEffectiveServings, sumPortions } from '@/lib/meal-planning/servings'
import { defineTool, ToolInputError } from '@/lib/mcp/context'

/** Days returned when the caller gives no `to`: today and the six after it. */
const DEFAULT_SPAN_DAYS = 7
/** Longest range one call may ask for, so a single answer stays small. */
const MAX_SPAN_DAYS = 31

const isoDate = z.iso.date()

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export const getMealPlan = defineTool({
  name: 'get_meal_plan',
  title: 'Get meal plan',
  description:
    "Returns the meals planned for the household by date and meal type. Use it to answer what is for dinner, what is planned this week, or whether a day has a meal yet. Defaults to today and the next 6 days in the household's timezone.",
  inputSchema: z.object({
    from: isoDate.optional().describe('First day, YYYY-MM-DD. Defaults to today.'),
    to: isoDate
      .optional()
      .describe(
        `Last day, inclusive, YYYY-MM-DD. Defaults to ${DEFAULT_SPAN_DAYS - 1} days after from.`,
      ),
  }),
  outputSchema: z.object({
    from: isoDate,
    to: isoDate,
    entries: z.array(
      z.object({
        date: isoDate,
        mealType: z.enum(['breakfast', 'lunch', 'dinner']),
        mealId: z.string().nullable(),
        mealName: z.string().nullable(),
        servings: z.number(),
        isCooked: z.boolean(),
        isSkipped: z.boolean(),
      }),
    ),
  }),
  run: async (household, input) => {
    const from = input.from ?? getTodayInTimezone(household.timezone)
    const startDate = parseLocalDate(from)
    const lastDay = input.to ? parseLocalDate(input.to) : addDays(startDate, DEFAULT_SPAN_DAYS - 1)

    if (lastDay < startDate) {
      throw new ToolInputError(
        'The date "to" is before "from". Ask again with to on or after from.',
      )
    }
    if (lastDay >= addDays(startDate, MAX_SPAN_DAYS)) {
      throw new ToolInputError(`Ask for ${MAX_SPAN_DAYS} days or fewer in one call.`)
    }

    const { entries } = await loadPlanEntries(household, {
      startDate,
      endDate: addDays(lastDay, 1),
    })
    const householdServings = sumPortions(household.members)

    return {
      from,
      to: toDateString(lastDay),
      entries: entries.map((entry) => ({
        date: entry.date,
        mealType: entry.mealType,
        mealId: entry.meal?.id ?? null,
        mealName: entry.meal?.name ?? null,
        servings: getEffectiveServings(entry, householdServings),
        isCooked: entry.status === 'completed',
        isSkipped: entry.status === 'skipped',
      })),
    }
  },
})
