import 'server-only'
import { z } from 'zod'
import { fuzzySearchIngredient } from '@/lib/ai/fuzzy-ingredient-match'
import { matchIngredients } from '@/lib/ai/match-ingredients'
import { translateIngredientNames } from '@/lib/ai/translate-match-results'
import { dayExtraOutputSchema, toDayExtraOutput } from '@/lib/api/v1/meal-plan'
import { createDayExtra } from '@/lib/day-extras/day-extras'
import { DAY_EXTRA_LABEL_MAX, DAY_EXTRA_QUANTITY_MAX } from '@/lib/day-extras/schemas'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { amountWarning } from './amount-warning'
import { MEASURED_UNITS } from './measured-units'
import { MAX_DAYS_AHEAD, writableDays } from './plan-slot'

export const addExtra = defineTool({
  name: 'add_extra',
  title: 'Add an extra to a day',
  description: `Adds one extra to a day: a snack, a drink or another item outside the meals, such as wine for Saturday. Call it again for each further item. The day is today or up to ${MAX_DAYS_AHEAD} days ahead. Give an amount as quantity and unit together, or neither. Wobblepot matches the name to its ingredient list. A sure match saves that ingredient, and it goes on the shopping list for the day. If a sure match's amount needs a check, nothing is saved and outcome is check_quantity with the amount Wobblepot made of it; confirm the amount with the user and call again with it in check.unit. With no sure match and no amount, the name is saved as free text and added to the shopping list as an item. With no sure match and an amount, nothing is saved and outcome is unmatched with the closest ingredients; ask the user which one they meant and call again with that name, or call without the amount. To change an extra's amount, use set_extra_amount.`,
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z
    .object({
      date: z.iso
        .date()
        .describe(`The day, YYYY-MM-DD: today or up to ${MAX_DAYS_AHEAD} days ahead.`),
      name: z
        .string()
        .trim()
        .min(1)
        .max(DAY_EXTRA_LABEL_MAX)
        .describe('The item alone, in the user’s words: "red wine", "chips".'),
      quantity: z
        .number()
        .positive()
        .max(DAY_EXTRA_QUANTITY_MAX)
        .optional()
        .describe('The amount in unit. Leave out with unit when the user gave no amount.'),
      unit: z
        .enum(MEASURED_UNITS)
        .optional()
        .describe('g, ml or piece. Convert other units first: 2 bottles of wine is 1500 ml.'),
    })
    .refine((i) => (i.quantity === undefined) === (i.unit === undefined), {
      message: 'Give quantity and unit together, or neither.',
    }),
  outputSchema: z.object({
    outcome: z
      .enum(['added', 'check_quantity', 'unmatched'])
      .describe(
        'added: the extra was saved. check_quantity: the name matched but the amount needs a check, so nothing was saved. unmatched: the name had no sure match and an amount was given, so nothing was saved.',
      ),
    extra: dayExtraOutputSchema.nullable().describe('For added: the saved extra.'),
    check: z
      .object({
        name: z.string(),
        quantity: z.number(),
        unit: z.enum(MEASURED_UNITS),
        warning: z.string(),
      })
      .nullable()
      .describe('For check_quantity: the matched ingredient, the amount converted, and why.'),
    alternatives: z
      .array(z.string())
      .describe('For unmatched: the closest ingredients Wobblepot has, at most 3.'),
  }),
  run: async (household, { date, name, quantity, unit }) => {
    const { today, lastDay } = writableDays(household.timezone)
    if (date < today) {
      throw new ToolInputError(
        `${date} is in the past, so an extra cannot be added to it. Nothing was changed.`,
      )
    }
    if (date > lastDay) {
      throw new ToolInputError(
        `${date} is more than ${MAX_DAYS_AHEAD} days ahead. Add to a day from today to ${lastDay}. Nothing was changed.`,
      )
    }

    const locale = resolveHouseholdLocale(household)
    const searchOptions = { householdId: household.id, locale }
    const hasAmount = quantity !== undefined && unit !== undefined
    // One item for one serving, so the converted amount is the whole extra in
    // the ingredient's `defaultUnit`. One item in gives one result out.
    const [result] = await matchIngredients(
      [
        {
          name,
          quantity: hasAmount ? quantity : null,
          unit: hasAmount ? unit : null,
          originalText: hasAmount ? `${quantity} ${unit} ${name}` : name,
          isVague: false,
          vaguePhrase: null,
          isDried: null,
        },
      ],
      1,
      searchOptions,
    )
    if (!result) throw new Error('matchIngredients returned no result for one item')

    if (result.type === 'matched' && !result.lowConfidence) {
      if (hasAmount) {
        const [named = result.ingredient] = await translateIngredientNames(
          [result.ingredient],
          locale,
        )
        const shown = displayUnit(result.ingredient)
        const warning = amountWarning(
          result,
          named.name,
          quantity,
          unit,
          result.convertedQuantity,
          shown,
        )
        if (warning) {
          return {
            outcome: 'check_quantity' as const,
            extra: null,
            check: { name: named.name, quantity: result.convertedQuantity, unit: shown, warning },
            alternatives: [],
          }
        }
      }
      return saved(
        await createDayExtra(household, {
          date,
          ingredientId: result.ingredient.id,
          quantity: hasAmount ? result.convertedQuantity : null,
        }),
        date,
      )
    }

    // Free text holds no amount, so a guess with one would drop what the user said.
    if (!hasAmount) return saved(await createDayExtra(household, { date, label: name }), date)

    const candidates =
      result.type === 'matched'
        ? (result.alternatives ?? [])
        : (await fuzzySearchIngredient(name, searchOptions)).slice(0, 3)
    const alternatives = await translateIngredientNames(candidates, locale)
    return {
      outcome: 'unmatched' as const,
      extra: null,
      check: null,
      alternatives: alternatives.map((c) => c.name),
    }
  },
})

function saved(outcome: Awaited<ReturnType<typeof createDayExtra>>, date: string) {
  // Both refusals need the day to turn over, or the ingredient to go, while this ran.
  if (outcome.status === 'past_date') {
    throw new ToolInputError(
      `${date} is in the past, so an extra cannot be added to it. Nothing was changed.`,
    )
  }
  if (outcome.status === 'ingredient_not_found') {
    throw new ToolInputError(
      'This ingredient was deleted while this ran. Call again to match the name. Nothing was changed.',
    )
  }
  return {
    outcome: 'added' as const,
    extra: toDayExtraOutput(outcome.extra),
    check: null,
    alternatives: [],
  }
}
