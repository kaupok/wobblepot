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

function itemOutput(item: PantryItemWithIngredient) {
  return {
    ingredientId: item.ingredientId,
    name: item.ingredient.name,
    quantity: item.quantity,
    unit: displayUnit(item.ingredient),
    isStaple: item.isStaple,
  }
}

export const setPantryStatus = defineTool({
  name: 'set_pantry_status',
  title: 'Set pantry status',
  description:
    'Records whether the household has an ingredient at home, and how much. have_some: it is in the pantry, with an amount or without one. ran_out: it is used up, so the shopping list needs the full amount again. Puts the ingredient in the pantry if it is not there yet. Pass an ingredientId from get_pantry or get_shopping_list. A staple stays a staple, and an ingredient that is not one does not become one: to star or unstar a staple, use set_staple. On a staple, ran_out puts the item on the shopping list now, also when no planned meal needs it. With have_some, pass amount when the user says how much there is, in the unit get_pantry reports: the shopping list then asks for that much less, and completing a meal takes its ingredients off it. A staple takes no amount.',
  annotations: WRITE_ANNOTATIONS,
  inputSchema: z
    .object({
      ingredientId: z
        .string()
        .min(1)
        .describe('The ingredientId of the ingredient, from get_pantry or get_shopping_list.'),
      status: z.enum(['have_some', 'ran_out']).describe('have_some: at home. ran_out: used up.'),
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
    }),
  }),
  run: async (household, { ingredientId, status, amount }) => {
    const quantity = amount ?? STATUS_QUANTITY[status]
    const created = await createPantryItem(household, { ingredientId, quantity, isStaple: false })

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

    // Only the quantity changes, so a staple stays a staple.
    const updated = await updatePantryItem(household, created.existingId, { quantity })
    if (updated.status === 'not_found') {
      // The household removed the item after `createPantryItem` read it.
      throw new ToolInputError('The pantry changed while this ran. Try again.')
    }
    return { outcome: 'updated' as const, item: itemOutput(updated.item) }
  },
})
