import 'server-only'
import { z } from 'zod'
import { loadDayExtras } from '@/lib/day-extras/day-extras'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { getEffectiveServings, sumPortions } from '@/lib/meal-planning/servings'
import { ToolInputError, type McpHousehold } from '@/lib/mcp/context'
import type { DayExtraView } from '@/components/meal-plan/types'

/**
 * The household's meal plan by date and meal type: the body of the
 * `get_meal_plan` MCP tool and of `GET /api/v1/meal-plan` (HON-1220), so an
 * assistant and a screen read the same thing.
 */

/** Days returned when the caller gives no `to`: today and the six after it. */
const DEFAULT_SPAN_DAYS = 7
/** Longest range one call may ask for, so a single answer stays small. */
const MAX_SPAN_DAYS = 31

const isoDate = z.iso.date()

export const mealPlanInputSchema = z.object({
  from: isoDate.optional().describe('First day, YYYY-MM-DD. Defaults to today.'),
  to: isoDate
    .optional()
    .describe(
      `Last day, inclusive, YYYY-MM-DD. Defaults to ${DEFAULT_SPAN_DAYS - 1} days after from.`,
    ),
})

/** One day extra (HON-1311), as `get_meal_plan` lists it and `add_extra` returns it. */
export const dayExtraOutputSchema = z.object({
  id: z.string(),
  date: isoDate,
  name: z.string().describe("The ingredient's name in the household's language, or the free text."),
  kind: z
    .enum(['ingredient', 'text'])
    .describe('ingredient: a catalogue ingredient. text: free text, with no amount.'),
  quantity: z.number().nullable().describe('The amount in unit, or null when it has none.'),
  unit: z.enum(['g', 'ml', 'piece']).nullable(),
})

export function toDayExtraOutput(extra: DayExtraView): z.output<typeof dayExtraOutputSchema> {
  return {
    id: extra.id,
    date: extra.date,
    name: extra.name,
    kind: extra.ingredientId ? 'ingredient' : 'text',
    // `quantity` is in the ingredient's `defaultUnit` and `unit` is how the
    // app shows it; 1 g is 1 ml, so a volume ingredient needs no conversion.
    quantity: extra.quantity,
    unit: extra.unit,
  }
}

export const mealPlanOutputSchema = z.object({
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
  extras: z
    .array(dayExtraOutputSchema)
    .describe('Snacks, drinks and other items added to a day, outside its meals.'),
})

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/**
 * Defaults to today and the next 6 days in the household's timezone. Throws
 * {@link ToolInputError} for a range the wrong way round or longer than
 * {@link MAX_SPAN_DAYS} days.
 */
export async function readMealPlan(
  household: McpHousehold,
  input: z.output<typeof mealPlanInputSchema>,
): Promise<z.output<typeof mealPlanOutputSchema>> {
  const from = input.from ?? getTodayInTimezone(household.timezone)
  const startDate = parseLocalDate(from)
  const lastDay = input.to ? parseLocalDate(input.to) : addDays(startDate, DEFAULT_SPAN_DAYS - 1)

  if (lastDay < startDate) {
    throw new ToolInputError('The date "to" is before "from". Ask again with to on or after from.')
  }
  if (lastDay >= addDays(startDate, MAX_SPAN_DAYS)) {
    throw new ToolInputError(`Ask for ${MAX_SPAN_DAYS} days or fewer in one call.`)
  }

  const range = { startDate, endDate: addDays(lastDay, 1) }
  const [{ entries }, extras] = await Promise.all([
    loadPlanEntries(household, range),
    loadDayExtras(household, range),
  ])
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
    extras: extras.map(toDayExtraOutput),
  }
}
