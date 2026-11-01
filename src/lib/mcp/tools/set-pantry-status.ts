import 'server-only'

import { z } from 'zod'

import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import {
  createPantryItem,
  type PantryItemWithIngredient,
  updatePantryItem,
} from '@/lib/pantry/pantry-items'

/**
 * The quantity each status writes when no amount comes with it. An amount
 * replaces `have_some`'s null: the pantry page shows and edits it, so the
 * household can see and correct what an assistant wrote (HON-1402, which partly
 * reverses HON-1201).
 */
const STATUS_QUANTITY = { have_some: null, ran_out: 0 } as const

/**
 * What each status writes on a row already in the pantry. `running_low` keeps
 * the amount, and `updatePantryItem` sets a row at 0 to have some (HON-1586).
 * `have_some` clears low; `ran_out` clears it through quantity 0.
 */
function statusUpdate(status: 'have_some' | 'ran_out' | 'running_low', amount?: number) {
  if (status === 'running_low') return { low: true }
  if (status === 'have_some') return { quantity: amount ?? STATUS_QUANTITY.have_some, low: false }
  return { quantity: STATUS_QUANTITY.ran_out }
}

function itemOutput(item: PantryItemWithIngredient) {
  return {
    ingredientId: item.ingredientId,
    name: item.ingredient.name,
    quantity: item.quantity,
    unit: displayUnit(item.ingredient),
    isStaple: item.isStaple,
    low: item.lowAt !== null,
  }
}

export const setPantryStatus = defineTool({
  name: 'set_pantry_status',
  title: 'Set pantry status',
  description:
    'Records whether the household has an ingredient at home, and how much. have_some: it is in the pantry, with an amount or without one. ran_out: it is used up, so the shopping list needs the full amount again. running_low: there is a little left, so it goes on the shopping list now, with no amount, and planned meals can still use it. Use it when the household says something is running out, nearly gone, or the last pack is open. Puts the ingredient in the pantry if it is not there yet. Pass an ingredientId from get_pantry, get_shopping_list or add_to_pantry. To put food the household bought in the pantry by name, use add_to_pantry. A staple stays a staple, and an ingredient that is not one does not become one: to star or unstar a staple, use set_staple. On a staple, ran_out puts the item on the shopping list now, also when no planned meal needs it. With have_some, pass amount when the user says how much there is, in the unit get_pantry reports: the shopping list then asks for that much less, and completing a meal takes its ingredients off it. A staple takes no amount.',
  annotations: WRITE_ANNOTATIONS,
  inputSchema: z
    .object({
      ingredientId: z
        .string()
        .min(1)
        .describe('The ingredientId of the ingredient, from get_pantry or get_shopping_list.'),
      status: z
        .enum(['have_some', 'ran_out', 'running_low'])
        .describe(
          'have_some: at home. ran_out: used up. running_low: a little left, so it goes on the shopping list.',
        ),
      amount: z
        .number()
        .positive()
        .optional()
        .describe(
          'How much is at home, in the unit get_pantry reports for the ingredient. Only with have_some. Leave out when the amount is unknown.',
        ),
    })
    .refine((i) => i.amount === undefined || i.status === 'have_some', {
      message: 'Give amount only with status have_some.',
    }),
  outputSchema: z.object({
    outcome: z
      .enum(['created', 'updated'])
      .describe('created: the ingredient was not in the pantry and now is. updated: it was.'),
    item: z.object({
      ingredientId: z.string(),
      name: z.string(),
      quantity: z
        .number()
        .nullable()
        .describe(
          'null: have some, amount unknown. Above 0: the amount at home, in unit. 0: ran out. The same field get_pantry reports.',
        ),
      unit: z.string(),
      isStaple: z.boolean(),
      low: z
        .boolean()
        .describe(
          'true: marked running low, so it is on the shopping list while planned meals can still use it.',
        ),
    }),
  }),
  run: async (household, { ingredientId, status, amount }) => {
    const created = await createPantryItem(household, {
      ingredientId,
      // Running low on a new row is have some plus low.
      quantity: status === 'running_low' ? null : (amount ?? STATUS_QUANTITY[status]),
      isStaple: false,
      low: status === 'running_low',
    })

    if (created.status === 'ingredient_not_found') {
      throw new ToolInputError(
        'Wobblepot has no ingredient with this id. Use an ingredientId from get_pantry or get_shopping_list. Nothing was changed.',
      )
    }
    if (created.status === 'created') {
      return { outcome: 'created' as const, item: itemOutput(created.item) }
    }

    // Completing a meal never takes a staple off, so an amount on one would
    // never change.
    if (created.isStaple && amount !== undefined) {
      throw new ToolInputError(
        'This ingredient is a staple, and a staple takes no amount. Call again without amount to record that the household has it. Nothing was changed.',
      )
    }

    // The staple flag is not written, so a staple stays a staple.
    const updated = await updatePantryItem(
      household,
      created.existingId,
      statusUpdate(status, amount),
    )
    if (updated.status === 'not_found') {
      // The household removed the item after `createPantryItem` read it.
      throw new ToolInputError('The pantry changed while this ran. Try again.')
    }
    return { outcome: 'updated' as const, item: itemOutput(updated.item) }
  },
})
