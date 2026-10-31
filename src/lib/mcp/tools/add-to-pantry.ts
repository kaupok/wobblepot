import 'server-only'

import { z } from 'zod'

import type { Unit } from '@/generated/prisma/enums'
import { fuzzySearchIngredient } from '@/lib/ai/fuzzy-ingredient-match'
import { matchIngredients } from '@/lib/ai/match-ingredients'
import { convertQuantity } from '@/lib/ai/recipe-quantities'
import { translateIngredientNames } from '@/lib/ai/translate-match-results'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { defineTool, type McpHousehold, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import {
  createPantryItem,
  findPantryIngredient,
  type PantryItemWithIngredient,
  updatePantryItem,
} from '@/lib/pantry/pantry-items'

import { amountWarning } from './amount-warning'
import { MEASURED_UNITS } from './measured-units'

/** A large shop has about 30 food lines; the cap keeps one call bounded. */
const MAX_ITEMS = 50

const entrySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe('The food alone, as the receipt or the user says it: "kartul", "punane paprika".'),
    ingredientId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'An ingredientId from candidates in an earlier result, or from get_pantry. It wins over name.',
      ),
    quantity: z
      .number()
      .positive()
      .optional()
      .describe('The amount bought, in unit. Leave out with unit when it is not known.'),
    unit: z
      .enum(MEASURED_UNITS)
      .optional()
      .describe('g, ml or piece. Convert other units first: 1.5 kg is 1500 g, 1 l is 1000 ml.'),
  })
  .refine((i) => (i.quantity === undefined) === (i.unit === undefined), {
    message: 'Give quantity and unit together, or neither.',
  })

type Entry = z.output<typeof entrySchema>

const itemSchema = z.object({
  ingredientId: z.string(),
  name: z.string(),
  quantity: z
    .number()
    .nullable()
    .describe('null: have some, amount unknown. Above 0: the amount at home, in unit.'),
  unit: z.string(),
  isStaple: z.boolean(),
})

const candidateSchema = z.object({ ingredientId: z.string(), name: z.string() })

const resultSchema = z.object({
  name: z.string().describe('The name as it was given.'),
  outcome: z
    .enum(['saved', 'unsure', 'unmatched', 'unknown_id', 'check_quantity'])
    .describe(
      'saved: the item is in the pantry. unsure: the name matched, but not surely. unmatched: the name matched nothing. unknown_id: Wobblepot has no ingredient with this ingredientId. check_quantity: the amount needs a check. Only saved changed the pantry.',
    ),
  item: itemSchema.nullable().describe('For saved: the pantry item as it is now.'),
  previous: z
    .object({ quantity: z.number().nullable() })
    .nullable()
    .describe(
      'For saved: the item before this call, with its quantity as get_pantry reports it. null: the ingredient was not in the pantry.',
    ),
  amountDropped: z
    .boolean()
    .describe(
      'true: an amount was given but not saved, because the ingredient is a staple and a staple takes no amount.',
    ),
  check: z
    .object({
      ingredientId: z.string(),
      name: z.string(),
      quantity: z.number(),
      unit: z.enum(MEASURED_UNITS),
      warning: z.string(),
    })
    .nullable()
    .describe('For check_quantity: the matched ingredient, the amount converted, and why.'),
  candidates: z
    .array(candidateSchema)
    .describe('For unsure and unmatched: the closest ingredients Wobblepot has, at most 3.'),
})

type Result = z.output<typeof resultSchema>

function itemOutput(item: PantryItemWithIngredient) {
  return {
    ingredientId: item.ingredientId,
    name: item.ingredient.name,
    quantity: item.quantity,
    unit: displayUnit(item.ingredient),
    isStaple: item.isStaple,
  }
}

/** One decimal, so 0.1 + 0.2 pieces is not saved as 0.30000000000000004. */
function rounded(quantity: number): number {
  return Math.round(quantity * 10) / 10
}

type NameMatch =
  | { status: 'sure'; ingredientId: string }
  | { status: 'unsure' | 'unmatched'; candidates: z.output<typeof candidateSchema>[] }

/** The name matched as `set_staple` and `add_extra` match it, one item per call. */
async function matchName(household: McpHousehold, name: string): Promise<NameMatch> {
  const locale = resolveHouseholdLocale(household)
  const searchOptions = { householdId: household.id, locale }
  // One item per call: `matchIngredients` merges two items that match one
  // ingredient, and the result must keep one row per receipt line.
  const [result] = await matchIngredients(
    [
      {
        name,
        quantity: null,
        unit: null,
        originalText: name,
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
    return { status: 'sure', ingredientId: result.ingredient.id }
  }
  const closest =
    result.type === 'matched'
      ? (result.alternatives ?? [])
      : (await fuzzySearchIngredient(name, searchOptions)).slice(0, 3)
  const candidates = await translateIngredientNames(closest, locale)
  return {
    status: result.type === 'matched' ? 'unsure' : 'unmatched',
    candidates: candidates.map((c) => ({ ingredientId: c.id, name: c.name })),
  }
}

function changedWhileRunning(name: string): ToolInputError {
  return new ToolInputError(
    `The pantry changed while this ran, so ${name} and the items after it were not saved. The items before it were saved. Call get_pantry, then send the rest again.`,
  )
}

async function addOne(household: McpHousehold, entry: Entry): Promise<Result> {
  const { name, quantity, unit } = entry
  const base = { name, item: null, previous: null, amountDropped: false, check: null }

  let id = entry.ingredientId
  if (id === undefined) {
    const match = await matchName(household, name)
    if (match.status !== 'sure') {
      return { ...base, outcome: match.status, candidates: match.candidates }
    }
    id = match.ingredientId
  }

  const found = await findPantryIngredient(household, id)
  if (found.status === 'ingredient_not_found') {
    return { ...base, outcome: 'unknown_id', candidates: [] }
  }
  const { ingredient, gramsPerPiece, item } = found

  let amount: number | null = null
  if (quantity !== undefined && unit !== undefined) {
    const defaultUnit = ingredient.defaultUnit as Unit
    const converted = rounded(convertQuantity(quantity, unit, { defaultUnit, gramsPerPiece }))
    const shown = displayUnit(ingredient)
    // No `quantityWarning`: that is a per-serving recipe limit (500 g), and a
    // pantry holds many servings. Only a guessed piece weight needs a check.
    const warning = amountWarning(
      { ingredient: { defaultUnit, gramsPerPiece } },
      ingredient.name,
      quantity,
      unit,
      converted,
      shown,
    )
    if (warning) {
      return {
        ...base,
        outcome: 'check_quantity',
        check: {
          ingredientId: id,
          name: ingredient.name,
          quantity: converted,
          unit: shown,
          warning,
        },
        candidates: [],
      }
    }
    amount = converted
  }

  if (!item) {
    const created = await createPantryItem(household, {
      ingredientId: id,
      quantity: amount,
      isStaple: false,
    })
    // The ingredient was deleted after the read above.
    if (created.status === 'ingredient_not_found') {
      return { ...base, outcome: 'unknown_id', candidates: [] }
    }
    // Another request added the ingredient after the read above.
    if (created.status === 'exists') throw changedWhileRunning(name)
    return { ...base, outcome: 'saved', item: itemOutput(created.item), candidates: [] }
  }

  // A receipt says what came in, so an amount adds to what is at home. An
  // unknown amount (null) and ran out (0) both count as none. A staple takes
  // no amount, because completing a meal never takes a staple off.
  const next = item.isStaple || amount === null ? null : rounded((item.quantity ?? 0) + amount)
  const updated = await updatePantryItem(household, item.id, { quantity: next })
  if (updated.status === 'not_found') throw changedWhileRunning(name)
  return {
    ...base,
    outcome: 'saved',
    item: itemOutput(updated.item),
    previous: { quantity: item.quantity },
    amountDropped: item.isStaple && amount !== null,
    candidates: [],
  }
}

export const addToPantry = defineTool({
  name: 'add_to_pantry',
  title: 'Add groceries to the pantry',
  description: `Puts food the household bought in the pantry, up to ${MAX_ITEMS} items in one call, such as a receipt or a grocery delivery. Give each item's name as the receipt or the user says it, in English or Estonian, and the amount when it is known. Wobblepot matches each name to its ingredient list, and only a sure match is saved. It converts the amount to the unit get_pantry reports, so 800 g of oranges becomes pieces. An amount adds to what is already at home. An item with no amount is saved as "have some", amount unknown. A staple takes no amount, so it is saved as "have some" and amountDropped is true. Each item gets its own outcome, in the order given, and an item that cannot be saved does not stop the others. saved: tell the user what each name matched when it differs from their words. unsure or unmatched: nothing was saved for that item; ask the user which of the candidates they meant and call again with only those items, each with its ingredientId. check_quantity: Wobblepot does not know what one piece weighs; confirm the amount with the user and call again with it in check.unit. To take out an item saved by mistake, use remove_from_pantry. To set an exact amount at home, use set_pantry_status.`,
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    items: z.array(entrySchema).min(1).max(MAX_ITEMS).describe('The food bought, one per line.'),
  }),
  outputSchema: z.object({
    items: z.array(resultSchema).describe('One result per item, in the order given.'),
  }),
  run: async (household, { items }) => {
    const results: Result[] = []
    // In order, one at a time, so two lines for one ingredient add up.
    for (const entry of items) results.push(await addOne(household, entry))
    return { items: results }
  },
})
