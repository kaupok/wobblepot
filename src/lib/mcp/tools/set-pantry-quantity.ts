import 'server-only'
import { z } from 'zod'
import {
  createPantryItem,
  pantryQuantitySchema,
  updatePantryItem,
  type PantryItemWithIngredient,
} from '@/lib/pantry/pantry-items'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'

function itemOutput(item: PantryItemWithIngredient) {
  return {
    ingredientId: item.ingredientId,
    name: item.ingredient.name,
    quantity: item.quantity,
    unit: displayUnit(item.ingredient),
    isStaple: item.isStaple,
  }
}

export const setPantryQuantity = defineTool({
  name: 'set_pantry_quantity',
  title: 'Set pantry quantity',
  description:
    'Sets how much of an ingredient the household has at home. Puts the ingredient in the pantry if it is not there yet. Pass an ingredientId from get_pantry or get_shopping_list. quantity is in the unit get_pantry reports for the ingredient (g, ml or piece); 0 means it ran out; null means "have some, amount unknown". A staple stays a staple.',
  annotations: WRITE_ANNOTATIONS,
  inputSchema: z.object({
    ingredientId: z
      .string()
      .min(1)
      .describe('The ingredientId of the ingredient, from get_pantry or get_shopping_list.'),
    quantity: pantryQuantitySchema.describe(
      'The amount at home, 0 or more, in g, ml or piece. 0: it ran out. null: some, amount unknown.',
    ),
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['created', 'updated'])
      .describe('created: the ingredient was not in the pantry and now is. updated: it was.'),
    item: z.object({
      ingredientId: z.string(),
      name: z.string(),
      quantity: z.number().nullable(),
      unit: z.string(),
      isStaple: z.boolean(),
    }),
  }),
  run: async (household, { ingredientId, quantity }) => {
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
      // The household removed the item between the two reads.
      throw new ToolInputError('The pantry changed while this ran. Try again.')
    }
    return { outcome: 'updated' as const, item: itemOutput(updated.item) }
  },
})
