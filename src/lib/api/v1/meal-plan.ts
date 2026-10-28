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
  unit: z.enum(['g', 'ml', 'piece']).nullable().describe('Null when quantity is null.'),
})

export function toDayExtraOutput(extra: DayExtraView): z.output<typeof dayExtraOutputSchema> {
  return {
    id: extra.id,
    date: extra.date,
    name: extra.name,
    kind: extra.ingredientId ? 'ingredient' : 'text',
    // `quantity` is in the ingredient's `defaultUnit` and `unit` is how the
    // app shows it; 1 g is 1 ml, so a volume ingredient needs no conversion.
    // With no amount there is no unit to read it in.
    quantity: extra.quantity,
    unit: extra.quantity === null ? null : extra.unit,
  }
}

/** One item of a fridge meal (HON-1281), as `get_meal_plan` lists it and `plan_fridge_meal` returns it. */
export const fridgeItemOutputSchema = z.object({
  name: z
    .string()
    .nullable()
    .describe(
      "The ingredient's name in the household's language, the leftover meal's name, or the free text. Null for leftovers whose meal was deleted since.",
    ),
  source: z
    .enum(['pantry', 'leftover', 'text'])
    .describe(
      'pantry: a catalogue ingredient. leftover: what is left of an earlier meal, cooked or planned. text: free text.',
    ),
  sourceEntryId: z
    .string()
    .nullable()
    .describe("A leftover's meal: its entryId, as plan_fridge_meal takes it. Null otherwise."),
  servings: z
    .number()
    .nullable()
    .describe(
      'How many servings of that meal a leftover takes. Null when none was set, and for pantry and text items.',
    ),
})

interface FridgeItemRow {
  sourceEntryId: string | null
  label: string | null
  name: string | null
  servings: number | null
}

/**
 * The card's naming rule (`useFridgeItemText`), without its weekday. A
 * leftover carries its source and servings, so an assistant can send the items
 * back unchanged (HON-1394).
 */
export function toFridgeItemOutput(item: FridgeItemRow): z.output<typeof fridgeItemOutputSchema> {
  if (item.label !== null) {
    return { name: item.label, source: 'text', sourceEntryId: null, servings: null }
  }
  if (item.sourceEntryId !== null) {
    return {
      name: item.name,
      source: 'leftover',
      sourceEntryId: item.sourceEntryId,
      servings: item.servings,
    }
  }
  return { name: item.name, source: 'pantry', sourceEntryId: null, servings: null }
}

export const mealPlanOutputSchema = z.object({
  from: isoDate,
  to: isoDate,
  entries: z.array(
    z.object({
      entryId: z
        .string()
        .describe(
          "The entry's id. A recipe meal's entryId is the sourceEntryId plan_fridge_meal takes for its leftovers.",
        ),
      date: isoDate,
      mealType: z.enum(['breakfast', 'lunch', 'dinner']),
      kind: z
        .enum(['recipe', 'fridge'])
        .describe(
          'recipe: a meal from a recipe, or an empty slot when mealId is null. fridge: a planned meal made of items at home, with no recipe.',
        ),
      items: z
        .array(fridgeItemOutputSchema)
        .describe("A fridge meal's items, in order. Empty for a recipe entry."),
      mealId: z.string().nullable(),
      mealName: z.string().nullable(),
      servings: z
        .number()
        .describe("The meal's own servings: the household's, or the entry's override."),
      cookServings: z
        .number()
        .describe(
          'The servings the meal is cooked and bought for: servings plus the leftovers planned from it, or the count it was cooked at.',
        ),
      leftoversFor: z
        .array(
          z.object({
            date: isoDate,
            mealType: z.enum(['breakfast', 'lunch', 'dinner']),
            servings: z.number().nullable(),
          }),
        )
        .describe(
          'The fridge meals that take leftovers of this meal, and how many servings each. Empty for a fridge meal.',
        ),
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
      entryId: entry.id,
      date: entry.date,
      mealType: entry.mealType,
      kind: entry.kind === 'fridge' ? ('fridge' as const) : ('recipe' as const),
      items: entry.items.map(toFridgeItemOutput),
      mealId: entry.meal?.id ?? null,
      mealName: entry.meal?.name ?? null,
      servings: getEffectiveServings(entry, householdServings),
      cookServings: entry.cookServings,
      leftoversFor: entry.leftoversFor,
      isCooked: entry.status === 'completed',
      isSkipped: entry.status === 'skipped',
    })),
    extras: extras.map(toDayExtraOutput),
  }
}
