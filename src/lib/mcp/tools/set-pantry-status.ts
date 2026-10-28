import 'server-only'
import { z } from 'zod'
import {
  createPantryItem,
  updatePantryItem,
  type PantryItemWithIngredient,
} from '@/lib/pantry/pantry-items'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'

/**
 * The two pantry states the app shows (HON-1201). The routes still accept an
 * amount, but the pantry page never writes one, so an amount from an assistant
 * would be a state the household cannot see or correct.
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
    'Records whether the household has an ingredient at home. have_some: it is in the pantry, amount unknown. ran_out: it is used up, so the shopping list needs the full amount again. Puts the ingredient in the pantry if it is not there yet. Pass an ingredientId from get_pantry or get_shopping_list. A staple stays a staple. On a staple, ran_out puts the item on the shopping list now, also when no planned meal needs it. Wobblepot does not track amounts, so an amount the user mentions is not stored.',
  annotations: WRITE_ANNOTATIONS,
  inputSchema: z.object({
    ingredientId: z
      .string()
      .min(1)
      .describe('The ingredientId of the ingredient, from get_pantry or get_shopping_list.'),
    status: z
      .enum(['have_some', 'ran_out'])
      .describe('have_some: at home, amount unknown. ran_out: used up.'),
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
        .describe('null: have some. 0: ran out. The same field get_pantry reports.'),
      unit: z.string(),
      isStaple: z.boolean(),
    }),
  }),
  run: async (household, { ingredientId, status }) => {
    const quantity = STATUS_QUANTITY[status]
    const created = await createPantryItem(household, { ingredientId, quantity, isStaple: false })

    if (created.status === 'ingredient_not_found') {
      throw new ToolInputError(
        'Wobblepot has no ingredient with this id. Use an ingredientId from get_pantry or get_shopping_list. Nothing was changed.',
      )
    }
    if (created.status === 'created') {
      return { outcome: 'created' as const, item: itemOutput(created.item) }
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
